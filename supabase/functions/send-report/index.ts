// ============================================================
// FASTRO — Edge Function: send-report
// Arma un resumen de ventas y lo envía por correo (Resend).
//
// Modos:
//   manual : invocada desde la app por un Admin (JWT). Envía siempre.
//   auto   : invocada por pg_cron con header x-cron-secret. Envía solo si
//            la config (app_config) indica que hoy toca semanal y/o mensual.
//
// Contenido del correo (cuerpo HTML, sin adjuntos):
//   - Ventas Totales y Total Ventas en Costo (GLOBALES, como el Dashboard).
//   - Pedidos creados en los últimos 7 días, agrupados por vendedor
//     (solo los vendedores que tienen pedidos en esa ventana).
//
// Envío por SMTP de Gmail: el correo sale desde tu propia casilla @gmail.com.
//
// Secrets requeridos (Supabase → Edge Functions → Secrets):
//   GMAIL_USER          → tu correo (ej. diagorr@gmail.com)
//   GMAIL_APP_PASSWORD  → "contraseña de aplicación" de Google (16 caracteres),
//                         NO la contraseña normal. Requiere Verificación en 2 pasos.
//   CRON_SECRET         → texto aleatorio compartido con el job de pg_cron
//   (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectados)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER         = Deno.env.get('GMAIL_USER') || '';
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') || '';
const CRON_SECRET        = Deno.env.get('CRON_SECRET') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ---- formato de plata (Guaraníes, sin decimales) ----
const gs = (n: number) =>
  '₲ ' + new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const fDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('es-PY') : '–';

const STATUS_LABEL: Record<string, string> = { open: 'Abierto', sent: 'Enviado', closed: 'Cerrado' };

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'auto' ? 'auto' : 'manual';

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ---- Autorización ----
    if (mode === 'auto') {
      // Llamada de pg_cron: validar el secreto compartido.
      if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) {
        return json({ error: 'No autorizado' }, 401);
      }
    } else {
      // Llamada manual desde la app: validar JWT y rol admin.
      const authHeader = req.headers.get('Authorization') || '';
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: 'Sesión inválida' }, 401);
      const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'admin') return json({ error: 'Solo un administrador puede enviar reportes' }, 403);
    }

    // ---- Configuración ----
    const { data: cfgRows } = await admin.from('app_config').select('key, value');
    const cfg: Record<string, string> = Object.fromEntries((cfgRows || []).map((r: any) => [r.key, r.value]));

    // ---- ¿Qué cadencias disparar? ----
    const reasons: string[] = [];
    if (mode === 'manual') {
      reasons.push('manual');
    } else {
      const now = new Date();
      const weekday = ((now.getUTCDay() + 6) % 7) + 1; // 1=Lun … 7=Dom
      const dayOfMonth = now.getUTCDate();
      if (cfg.report_weekly_enabled === 'true' && String(weekday) === String(cfg.report_weekly_weekday || '1')) {
        reasons.push('semanal');
      }
      if (cfg.report_monthly_enabled === 'true' && String(dayOfMonth) === String(cfg.report_monthly_day || '1')) {
        reasons.push('mensual');
      }
      if (!reasons.length) return json({ skipped: true, message: 'Hoy no corresponde envío automático' });
    }

    // ---- Destinatarios ----
    let recipientIds: string[] = [];
    try { recipientIds = JSON.parse(cfg.report_recipients || '[]'); } catch { recipientIds = []; }
    if (!recipientIds.length) return json({ error: 'No hay destinatarios configurados' }, 400);

    const { data: recProfiles } = await admin
      .from('profiles').select('email').in('id', recipientIds);
    const emails = (recProfiles || []).map((p: any) => p.email).filter((e: string) => e && e.includes('@'));
    if (!emails.length) return json({ error: 'Los destinatarios no tienen correo válido' }, 400);

    // ---- Datos ----
    const { data: orders } = await admin.from('orders')
      .select('id, order_number, status, discount_pct, created_at, user_id, clients(name), users:profiles(name)');
    const { data: items } = await admin.from('order_items')
      .select('order_id, quantity, unit_sale_price, unit_cost_price');

    const revByOrder: Record<string, number> = {};
    const costByOrder: Record<string, number> = {};
    (items || []).forEach((i: any) => {
      revByOrder[i.order_id]  = (revByOrder[i.order_id]  || 0) + i.quantity * i.unit_sale_price;
      costByOrder[i.order_id] = (costByOrder[i.order_id] || 0) + i.quantity * i.unit_cost_price;
    });

    let totalRev = 0, totalCost = 0;
    (orders || []).forEach((o: any) => {
      totalRev  += (revByOrder[o.id]  || 0) * (1 - (o.discount_pct || 0) / 100);
      totalCost += (costByOrder[o.id] || 0);
    });

    // Pedidos de los últimos 7 días, agrupados por vendedor
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = (orders || [])
      .filter((o: any) => new Date(o.created_at).getTime() >= since)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const bySeller: Record<string, any[]> = {};
    recent.forEach((o: any) => {
      const seller = o.users?.name || 'Sin asignar';
      (bySeller[seller] = bySeller[seller] || []).push(o);
    });

    // ---- HTML ----
    const html = buildHtml(totalRev, totalCost, bySeller, revByOrder);
    const subject = `FASTRO — Reporte de ventas (${reasons.join(' y ')}) · ${new Date().toLocaleDateString('es-PY')}`;

    // ---- Enviar (Gmail SMTP) ----
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      return json({ error: 'Falta configurar GMAIL_USER o GMAIL_APP_PASSWORD en los secrets' }, 500);
    }
    // Compactar el espacio en blanco entre etiquetas: evita que la codificación
    // quoted-printable deje artefactos visibles tipo "=20" en algunos clientes.
    const cleanHtml = html.replace(/>\s+</g, '><').trim();

    const smtp = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD },
      },
    });
    try {
      await smtp.send({
        from: `FASTRO S.A. <${GMAIL_USER}>`,
        to: emails,
        subject,
        content: 'Reporte de ventas FASTRO. Abrí este correo en formato HTML para verlo.',
        html: cleanHtml,
      });
    } finally {
      await smtp.close();
    }

    return json({ ok: true, sent: emails.length, reasons });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
});

function buildHtml(
  totalRev: number,
  totalCost: number,
  bySeller: Record<string, any[]>,
  revByOrder: Record<string, number>,
): string {
  const sellers = Object.keys(bySeller).sort();

  const sellerBlocks = sellers.length ? sellers.map((name) => {
    const rows = bySeller[name].map((o: any) => {
      const tot = (revByOrder[o.id] || 0) * (1 - (o.discount_pct || 0) / 100);
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap"><strong>${esc(o.order_number)}</strong></td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(o.clients?.name || '–')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${gs(tot)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(STATUS_LABEL[o.status] || o.status)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;white-space:nowrap">${fDate(o.created_at)}</td>
      </tr>`;
    }).join('');
    return `
      <h3 style="margin:22px 0 8px;font-size:15px;color:#111">${esc(name)} <span style="color:#888;font-weight:normal">(${bySeller[name].length})</span></h3>
      <table role="presentation" class="ord-table" width="100%" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#9B0000;color:#fff">
            <th style="padding:8px 10px;text-align:left">N° Pedido</th>
            <th style="padding:8px 10px;text-align:left">Cliente</th>
            <th style="padding:8px 10px;text-align:right">Total</th>
            <th style="padding:8px 10px;text-align:left">Estado</th>
            <th style="padding:8px 10px;text-align:left">Fecha</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join('') : `<p style="color:#666">No se crearon pedidos en los últimos 7 días.</p>`;

  return `<!doctype html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media only screen and (max-width:600px){
        .kpi-cell{display:block!important;width:100%!important;box-sizing:border-box!important}
        .kpi-cell.first{margin-bottom:10px!important}
        .kpi-gap{display:none!important}
        .ord-table{font-size:12px!important}
        .ord-table th,.ord-table td{padding:6px 8px!important}
        .wrap{padding:16px!important}
      }
    </style>
  </head>
  <body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222">
    <div style="max-width:680px;width:100%;margin:0 auto;background:#fff">
      <div style="background:#111;color:#fff;padding:18px 24px">
        <div style="font-size:18px;font-weight:700">FASTRO S.A.</div>
        <div style="font-size:12px;opacity:.8">Reporte de ventas · ${new Date().toLocaleDateString('es-PY')}</div>
      </div>
      <div class="wrap" style="padding:24px">
        <table role="presentation" width="100%" style="width:100%;border-collapse:separate;border-spacing:0;margin-bottom:8px">
          <tr>
            <td class="kpi-cell first" style="padding:14px 16px;background:#f8f8fa;border:1px solid #eee;border-radius:8px;width:50%;vertical-align:top">
              <div style="font-size:12px;color:#888">Ventas Totales</div>
              <div style="font-size:20px;font-weight:700;color:#9B0000">${gs(totalRev)}</div>
            </td>
            <td class="kpi-gap" style="width:12px"></td>
            <td class="kpi-cell" style="padding:14px 16px;background:#f8f8fa;border:1px solid #eee;border-radius:8px;width:50%;vertical-align:top">
              <div style="font-size:12px;color:#888">Total Ventas en Costo</div>
              <div style="font-size:20px;font-weight:700;color:#111">${gs(totalCost)}</div>
            </td>
          </tr>
        </table>

        <h2 style="font-size:15px;color:#111;margin:24px 0 4px">Pedidos de los últimos 7 días por vendedor</h2>
        ${sellerBlocks}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #eee;color:#999;font-size:11px">
        Generado automáticamente por el sistema de pedidos FASTRO.
      </div>
    </div>
  </body></html>`;
}
