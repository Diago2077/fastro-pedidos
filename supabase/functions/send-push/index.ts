// ============================================================
// FASTRO — Edge Function: send-push
// Envía notificaciones push (Web Push / VAPID) a los dispositivos suscriptos.
//
// Tipos de envío (body.type):
//   order_status : disparado por la app cuando un pedido cambia de estado.
//                  Va a los usuarios marcados en "Reportes por correo"
//                  (app_config.report_recipients), EXCEPTO quien hizo el cambio.
//   manual       : envío puntual desde Configuración (solo Admin) a un usuario.
//
// Auth: siempre valida el JWT del usuario que invoca (Authorization). El modo
//       manual exige además rol admin. Desplegar con Verify JWT = OFF (la
//       función hace su propia validación, como send-report).
//
// Secrets requeridos (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  → par de claves (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT                        → mailto:tu-correo  (ej. mailto:facturacion.fastro@gmail.com)
//   (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectados)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     || 'mailto:admin@fastro.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const STATUS_LABEL: Record<string, string> = { open: 'Abierto', sent: 'Enviado', closed: 'Cerrado' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return json({ error: 'Faltan los secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const type = body?.type === 'manual' ? 'manual' : 'order_status';

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ---- Autorización: siempre exige sesión válida ----
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Sesión inválida' }, 401);

    // ---- Resolver destinatarios + payload según el tipo ----
    let recipientIds: string[] = [];
    let payload: { title: string; body: string; url: string };

    if (type === 'manual') {
      const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'admin') return json({ error: 'Solo un administrador puede enviar manualmente' }, 403);

      const targetId = String(body?.userId || '');
      const message  = String(body?.message || '').trim();
      if (!targetId)  return json({ error: 'Falta el usuario destinatario' }, 400);
      if (!message)   return json({ error: 'El mensaje está vacío' }, 400);

      recipientIds = [targetId];
      payload = {
        title: String(body?.title || 'FASTRO'),
        body:  message,
        url:   '/',
      };
    } else {
      // order_status: destinatarios = report_recipients, menos el actor.
      const orderId = String(body?.orderId || '');
      const status  = String(body?.status || '');
      if (!orderId) return json({ error: 'Falta el pedido' }, 400);

      const { data: cfgRows } = await admin.from('app_config').select('value').eq('key', 'report_recipients').maybeSingle();
      try { recipientIds = JSON.parse(cfgRows?.value || '[]'); } catch { recipientIds = []; }
      recipientIds = recipientIds.filter((id) => id && id !== user.id); // no avisar al actor
      if (!recipientIds.length) return json({ ok: true, sent: 0, failed: 0, note: 'sin destinatarios' });

      const { data: ord } = await admin.from('orders').select('order_number').eq('id', orderId).maybeSingle();
      const numero = ord?.order_number || 'sin número';
      payload = {
        title: `FASTRO — Pedido ${numero}`,
        body:  `Pasó a ${STATUS_LABEL[status] || status}`,
        url:   '/?go=orders',
      };
    }

    // ---- Suscripciones de esos usuarios ----
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', recipientIds);
    if (!subs || !subs.length) return json({ ok: true, sent: 0, failed: 0, note: 'sin dispositivos suscriptos' });

    // ---- Enviar a cada dispositivo ----
    const data = JSON.stringify(payload);
    let sent = 0, failed = 0;
    const deadIds: string[] = [];

    await Promise.all(subs.map(async (s: any) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, data);
        sent++;
      } catch (err: any) {
        failed++;
        const code = err?.statusCode;
        if (code === 404 || code === 410) deadIds.push(s.id); // suscripción muerta
      }
    }));

    // ---- Limpiar suscripciones muertas ----
    if (deadIds.length) await admin.from('push_subscriptions').delete().in('id', deadIds);

    return json({ ok: true, sent, failed, cleaned: deadIds.length });
  } catch (err: any) {
    return json({ error: String(err?.message || err) }, 500);
  }
});
