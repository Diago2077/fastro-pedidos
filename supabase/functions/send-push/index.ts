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
// Envío con `@negrel/webpush` (nativo de Deno / WebCrypto — NO usa la librería
// npm:web-push, que crashea en el runtime de Supabase Edge).
//
// Secrets requeridos (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  → par de claves (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT                        → mailto:tu-correo  (ej. mailto:facturacion.fastro@gmail.com)
//   (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectados)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@0.5.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')     || 'mailto:admin@fastro.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const STATUS_LABEL: Record<string, string> = { open: 'Abierto', sent: 'Enviado', closed: 'Cerrado', cancelled: 'Cancelado' };

// ---- VAPID: convertir las claves base64url (formato web-push) a JWK ----
function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function vapidJwks() {
  const pub = b64urlToBytes(VAPID_PUBLIC); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = bytesToB64url(pub.slice(1, 33));
  const y = bytesToB64url(pub.slice(33, 65));
  const d = VAPID_PRIVATE.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base = { kty: 'EC', crv: 'P-256', alg: 'ES256', ext: true };
  return {
    publicKey:  { ...base, x, y, key_ops: ['verify'] },
    privateKey: { ...base, x, y, d, key_ops: ['sign'] },
  };
}

// ApplicationServer cacheado entre invocaciones (reúsa el worker).
let _appServer: webpush.ApplicationServer | null = null;
async function getAppServer() {
  if (_appServer) return _appServer;
  const vapidKeys = await webpush.importVapidKeys(vapidJwks(), { extractable: true });
  _appServer = await webpush.ApplicationServer.new({ contactInformation: VAPID_SUBJECT, vapidKeys });
  return _appServer;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return json({ error: 'Faltan los secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY' }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const type = ['manual', 'broadcast'].includes(body?.type) ? body.type : 'order_status';

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
    let toEveryone = false; // broadcast: a todos los dispositivos suscriptos
    let payload: { title: string; body: string; url: string };

    if (type === 'manual' || type === 'broadcast') {
      // Ambos son envíos manuales de Admin.
      const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (prof?.role !== 'admin') return json({ error: 'Solo un administrador puede enviar manualmente' }, 403);

      const message = String(body?.message || '').trim();
      if (!message) return json({ error: 'El mensaje está vacío' }, 400);

      if (type === 'broadcast') {
        toEveryone = true;
      } else {
        const targetId = String(body?.userId || '');
        if (!targetId) return json({ error: 'Falta el usuario destinatario' }, 400);
        recipientIds = [targetId];
      }
      payload = { title: String(body?.title || 'Mensaje'), body: message, url: '/' };
    } else {
      // order_status: destinatarios = notify_recipients (propios de notificaciones), menos el actor.
      const orderId = String(body?.orderId || '');
      const status  = String(body?.status || '');
      if (!orderId) return json({ error: 'Falta el pedido' }, 400);

      const { data: cfgRows } = await admin.from('app_config').select('value').eq('key', 'notify_recipients').maybeSingle();
      try { recipientIds = JSON.parse(cfgRows?.value || '[]'); } catch { recipientIds = []; }
      recipientIds = recipientIds.filter((id) => id && id !== user.id); // no avisar al actor
      if (!recipientIds.length) return json({ ok: true, sent: 0, failed: 0, note: 'sin destinatarios' });

      const { data: ord } = await admin.from('orders').select('order_number, clients(name)').eq('id', orderId).maybeSingle();
      const numero  = ord?.order_number || 'sin número';
      const cliente = (ord as any)?.clients?.name || '';
      const estado  = STATUS_LABEL[status] || status;
      payload = {
        title: `Pedido ${numero}`,
        body:  cliente ? `${cliente} · Pasó a ${estado}` : `Pasó a ${estado}`,
        url:   '/?go=orders',
      };
    }

    // ---- Suscripciones (de los destinatarios, o de todos si es broadcast) ----
    let subsQuery = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth');
    if (!toEveryone) subsQuery = subsQuery.in('user_id', recipientIds);
    const { data: subs } = await subsQuery;
    if (!subs || !subs.length) return json({ ok: true, sent: 0, failed: 0, note: 'sin dispositivos suscriptos' });

    // ---- Enviar a cada dispositivo ----
    const appServer = await getAppServer();
    const data = JSON.stringify(payload);
    let sent = 0, failed = 0;
    const deadIds: string[] = [];

    await Promise.all(subs.map(async (s: any) => {
      try {
        const subscriber = appServer.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
        await subscriber.pushTextMessage(data, { urgency: webpush.Urgency.High });
        sent++;
      } catch (err: any) {
        failed++;
        const status = err?.response?.status;
        if (status === 404 || status === 410) deadIds.push(s.id); // suscripción muerta
      }
    }));

    // ---- Limpiar suscripciones muertas ----
    if (deadIds.length) await admin.from('push_subscriptions').delete().in('id', deadIds);

    return json({ ok: true, sent, failed, cleaned: deadIds.length });
  } catch (err: any) {
    return json({ error: String(err?.message || err) }, 500);
  }
});
