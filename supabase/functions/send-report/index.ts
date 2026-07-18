// ============================================================
// FASTRO — Edge Function: send-report
// Arma un resumen de ventas y lo envía por correo (SMTP de Gmail).
//
// Modos:
//   manual : invocada desde la app por un Admin (JWT). Envía siempre.
//   auto   : invocada por pg_cron con header x-cron-secret. Envía solo si
//            la config (app_config) indica que hoy toca semanal y/o mensual.
//
// Contenido del correo:
//   - Cuerpo HTML liviano (solo los totales, sin tablas ni <style>).
//   - PDF adjunto con el detalle: Ventas Totales, Total Ventas en Costo y
//     los pedidos de los últimos 7 días agrupados por vendedor.
//   - Los pedidos "Cancelados" no suman ni aparecen (igual que en el
//     Dashboard y Reportes de la app).
//
// Por qué HTML liviano + PDF (y no la tabla HTML de antes): Gmail bloqueó un
// envío con "550 5.7.1 ... likely unsolicited mail" (filtro de spam saliente).
// Un correo con mucho HTML/tablas + varios destinatarios en "Para", enviado
// por SMTP desde un servidor en la nube, es justamente el patrón que ese
// filtro suele marcar. Se ataca con dos cambios: (1) cuerpo simple, detalle
// en un PDF adjunto; (2) destinatarios en BCC (copia oculta), con el propio
// remitente como único "Para".
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
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

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
// La fuente Helvetica (HTML y PDF) no tiene el glifo ₲: usamos "Gs." en el correo.
const gs = (n: number) =>
  'Gs. ' + new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const fDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('es-PY') : '–';

const STATUS_LABEL: Record<string, string> = { open: 'Abierto', sent: 'Enviado', closed: 'Cerrado' };

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

    // ---- Datos (los pedidos Cancelados no suman, igual que en el Dashboard) ----
    const { data: ordersRaw } = await admin.from('orders')
      .select('id, order_number, status, discount_pct, created_at, user_id, clients(name), users:profiles(name)');
    const orders = (ordersRaw || []).filter((o: any) => o.status !== 'cancelled');
    const { data: items } = await admin.from('order_items')
      .select('order_id, quantity, unit_sale_price, unit_cost_price');

    const revByOrder: Record<string, number> = {};
    const costByOrder: Record<string, number> = {};
    (items || []).forEach((i: any) => {
      revByOrder[i.order_id]  = (revByOrder[i.order_id]  || 0) + i.quantity * i.unit_sale_price;
      costByOrder[i.order_id] = (costByOrder[i.order_id] || 0) + i.quantity * i.unit_cost_price;
    });

    let totalRev = 0, totalCost = 0;
    orders.forEach((o: any) => {
      totalRev  += (revByOrder[o.id]  || 0) * (1 - (o.discount_pct || 0) / 100);
      totalCost += (costByOrder[o.id] || 0);
    });

    // Pedidos de los últimos 7 días, agrupados por vendedor
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = orders
      .filter((o: any) => new Date(o.created_at).getTime() >= since)
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const bySeller: Record<string, any[]> = {};
    recent.forEach((o: any) => {
      const seller = o.users?.name || 'Sin asignar';
      (bySeller[seller] = bySeller[seller] || []).push(o);
    });
    const sellerCount = Object.keys(bySeller).length;

    // ---- HTML (liviano: sin tablas ni <style>, el detalle va en el PDF) ----
    const html = buildHtml(totalRev, totalCost, sellerCount, recent.length);
    const subject = `FASTRO — Reporte de ventas (${reasons.join(' y ')}) · ${new Date().toLocaleDateString('es-PY')}`;

    // ---- PDF adjunto con el detalle completo ----
    const pdfBytes = await buildReportPdf(totalRev, totalCost, bySeller, revByOrder);
    const fileDate = new Date().toISOString().split('T')[0];

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
        // "Para" = el propio remitente; los destinatarios reales van en copia
        // oculta. Evita exponer los correos entre sí y que Gmail lo trate
        // como un envío masivo a muchos "Para" (una de las señales de spam).
        to: GMAIL_USER,
        bcc: emails,
        subject,
        content: `Reporte de ventas FASTRO adjunto en PDF.\n\nVentas Totales: ${gs(totalRev)}\nTotal Ventas en Costo: ${gs(totalCost)}`,
        html: cleanHtml,
        attachments: [{
          filename: `reporte-ventas-${fileDate}.pdf`,
          contentType: 'application/pdf',
          encoding: 'binary',
          content: pdfBytes,
        }],
      });
    } finally {
      await smtp.close();
    }

    return json({ ok: true, sent: emails.length, reasons });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
});

// ============================================================
// CORREO — cuerpo HTML liviano (solo los totales; el detalle va en el PDF)
// ============================================================
function buildHtml(totalRev: number, totalCost: number, sellerCount: number, orderCount: number): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#222">
    <div style="max-width:520px;margin:0 auto;padding:20px">
      <p style="font-size:16px;font-weight:bold;color:#111;margin:0 0 4px">FASTRO S.A.</p>
      <p style="font-size:12px;color:#888;margin:0 0 20px">Reporte de ventas · ${new Date().toLocaleDateString('es-PY')}</p>
      <p style="font-size:14px;margin:0 0 6px">Ventas Totales: <strong style="color:#9B0000">${gs(totalRev)}</strong></p>
      <p style="font-size:14px;margin:0 0 6px">Total Ventas en Costo: <strong>${gs(totalCost)}</strong></p>
      <p style="font-size:14px;margin:16px 0 0">
        ${orderCount ? `${orderCount} pedido(s) en los últimos 7 días, de ${sellerCount} vendedor(es).` : 'No se crearon pedidos en los últimos 7 días.'}
      </p>
      <p style="font-size:14px;margin:8px 0 20px">El detalle completo está en el PDF adjunto.</p>
      <p style="font-size:11px;color:#999;margin-top:24px">Generado automáticamente por el sistema de pedidos FASTRO.</p>
    </div>
  </body></html>`;
}

// ============================================================
// PDF — detalle completo (KPIs + pedidos de los últimos 7 días por vendedor)
// Usa pdf-lib (funciona bien en el runtime Deno de Supabase Edge, a diferencia
// de librerías con dependencias de Node como npm:web-push).
// ============================================================
async function buildReportPdf(
  totalRev: number,
  totalCost: number,
  bySeller: Record<string, any[]>,
  revByOrder: Record<string, number>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595.28, PAGE_H = 841.89; // A4 en puntos
  const MARGIN = 40;
  const RED  = rgb(0.608, 0, 0);
  const DARK = rgb(0.1, 0.1, 0.1);
  const GRAY = rgb(0.45, 0.45, 0.45);
  const LINE = rgb(0.85, 0.85, 0.85);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPageIfNeeded(need = 20) {
    if (y - need < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }
  function truncate(s: string, max: number) {
    s = String(s || '–');
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // Cabecera
  page.drawRectangle({ x: 0, y: PAGE_H - 55, width: PAGE_W, height: 55, color: DARK });
  page.drawText('FASTRO S.A.', { x: MARGIN, y: PAGE_H - 26, size: 15, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText(`Reporte de ventas - ${new Date().toLocaleDateString('es-PY')}`, {
    x: MARGIN, y: PAGE_H - 42, size: 9, font, color: rgb(0.85, 0.85, 0.85),
  });
  y = PAGE_H - 80;

  // KPIs
  page.drawText('Ventas Totales:', { x: MARGIN, y, size: 11, font: fontBold, color: DARK });
  page.drawText(gs(totalRev), { x: MARGIN + 110, y, size: 11, font: fontBold, color: RED });
  y -= 18;
  page.drawText('Total Ventas en Costo:', { x: MARGIN, y, size: 11, font: fontBold, color: DARK });
  page.drawText(gs(totalCost), { x: MARGIN + 150, y, size: 11, font: fontBold, color: DARK });
  y -= 30;

  page.drawText('Pedidos de los ultimos 7 dias por vendedor', { x: MARGIN, y, size: 12, font: fontBold, color: DARK });
  y -= 20;

  const sellers = Object.keys(bySeller).sort();
  if (!sellers.length) {
    page.drawText('No se crearon pedidos en los ultimos 7 dias.', { x: MARGIN, y, size: 10, font, color: GRAY });
    y -= 16;
  }

  const COLS: [number, string][] = [
    [MARGIN, 'N. Pedido'], [MARGIN + 90, 'Cliente'], [MARGIN + 270, 'Total'], [MARGIN + 350, 'Estado'], [MARGIN + 420, 'Fecha'],
  ];

  for (const name of sellers) {
    newPageIfNeeded(46);
    page.drawText(`${name} (${bySeller[name].length})`, { x: MARGIN, y, size: 11, font: fontBold, color: RED });
    y -= 15;
    COLS.forEach(([x, label]) => page.drawText(label, { x, y, size: 8, font: fontBold, color: GRAY }));
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: LINE });
    y -= 12;

    for (const o of bySeller[name]) {
      newPageIfNeeded(14);
      const tot = (revByOrder[o.id] || 0) * (1 - (o.discount_pct || 0) / 100);
      page.drawText(truncate(o.order_number, 14), { x: MARGIN, y, size: 8, font, color: DARK });
      page.drawText(truncate(o.clients?.name, 28), { x: MARGIN + 90, y, size: 8, font, color: DARK });
      page.drawText(gs(tot), { x: MARGIN + 270, y, size: 8, font, color: DARK });
      page.drawText(STATUS_LABEL[o.status] || o.status, { x: MARGIN + 350, y, size: 8, font, color: DARK });
      page.drawText(fDate(o.created_at), { x: MARGIN + 420, y, size: 8, font, color: DARK });
      y -= 14;
    }
    y -= 14;
  }

  return await doc.save();
}
