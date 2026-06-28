// ============================================================
// NOTIFICACIONES PUSH (Web Push / VAPID)
// Suscribe el dispositivo al servicio de push del navegador y guarda la
// suscripción en Supabase (tabla push_subscriptions). El envío real lo hace
// la Edge Function `send-push`.
//
// IMPORTANTE: pegá acá la CLAVE PÚBLICA VAPID (la misma que cargaste en el
// secret VAPID_PUBLIC_KEY de la función). Es pública: no hay problema en que
// viva en el frontend. Generala con:  npx web-push generate-vapid-keys
// ============================================================
import { db } from './supabase.js';
import { getSession } from './auth.js';

export const VAPID_PUBLIC_KEY = 'PEGAR_AQUI_LA_CLAVE_PUBLICA_VAPID';

// ¿El navegador soporta push? (iPhone/iPad: solo con la app instalada en
// pantalla de inicio, iOS 16.4+).
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// 'granted' | 'denied' | 'default' | 'unsupported'
export function getPermissionState() {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

// ¿Este dispositivo ya está suscripto?
export async function isSubscribed() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch { return false; }
}

// Activar: pide permiso, suscribe y guarda la suscripción en la base.
// Devuelve true si quedó activado.
export async function enablePush() {
  if (!isPushSupported()) throw new Error('Este dispositivo no soporta notificaciones.');
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith('PEGAR_AQUI')) {
    throw new Error('Falta configurar la clave pública VAPID en js/push.js.');
  }
  const me = getSession();
  if (!me?.id) throw new Error('No hay sesión activa.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await db.from('push_subscriptions').upsert({
    user_id:    me.id,
    endpoint:   sub.endpoint,
    p256dh:     json.keys?.p256dh,
    auth:       json.keys?.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);

  return true;
}

// Desactivar en este dispositivo: cancela la suscripción y borra su fila.
export async function disablePush() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch {}
  await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// Disparo automático: avisar el cambio de estado de un pedido.
// Fire-and-forget: NUNCA debe romper ni demorar el cambio de estado.
export function notifyOrderStatus(orderId, status) {
  try {
    db.functions.invoke('send-push', { body: { type: 'order_status', orderId, status } })
      .catch(() => {});
  } catch { /* ignorar */ }
}

// Convierte la clave VAPID (base64url) al formato que espera pushManager.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
