// ============================================================
// AUTENTICACIÓN (sesión propia, sin Supabase Auth)
// ============================================================
import { db } from './supabase.js';
import { hashPwd } from './utils/helpers.js';

const KEY = 'fastro_user';

export function getSession() {
  try {
    const s = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export function saveSession(user, remember = false) {
  const payload = JSON.stringify(user);
  sessionStorage.setItem(KEY, payload);
  if (remember) localStorage.setItem(KEY, payload);
}

export function clearSession() {
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
}

export function isAdmin() {
  return getSession()?.role === 'admin';
}

export async function login(email, password) {
  const hash = await hashPwd(password);
  const { data, error } = await db
    .from('users')
    .select('id, name, email, role, active')
    .eq('email', email.toLowerCase().trim())
    .eq('password_hash', hash)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error('Error de conexión con la base de datos');
  if (!data) throw new Error('Correo o contraseña incorrectos');
  return data;
}

export function logout() {
  clearSession();
  window.location.reload();
}
