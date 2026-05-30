// ============================================================
// AUTENTICACIÓN sobre Supabase Auth
// La sesión la maneja Supabase (localStorage + auto-refresh).
// El "profile" (rol + permisos) se cachea en memoria para que
// getSession() siga siendo SÍNCRONO (como esperan los módulos).
// ============================================================
import { db } from './supabase.js';

let _profile = null;

const PROFILE_SELECT = `id, email, name, role, active,
  can_see_cost, can_export_excel,
  can_view_dashboard,
  can_view_orders, can_create_orders, can_edit_orders, can_delete_orders,
  can_view_clients, can_create_clients, can_edit_clients, can_delete_clients,
  can_view_products, can_create_products, can_edit_products, can_delete_products,
  can_view_providers, can_create_providers, can_edit_providers, can_delete_providers,
  can_view_reports`;

// Devuelve el profile cacheado (sincrónico). null si no hay sesión.
export function getSession() { return _profile; }

async function loadProfile(userId) {
  const { data, error } = await db.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle();
  if (error) { console.warn('loadProfile error:', error.message); return null; }
  return data;
}

// Arranque: restaura la sesión de Supabase y carga el profile en cache.
export async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session?.user) { _profile = null; return null; }
  const profile = await loadProfile(session.user.id);
  if (!profile || !profile.active) { await db.auth.signOut(); _profile = null; return null; }
  _profile = profile;
  return _profile;
}

export async function login(email, password) {
  const { data, error } = await db.auth.signInWithPassword({
    email: (email || '').toLowerCase().trim(),
    password
  });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) throw new Error('Correo o contraseña incorrectos');
    if (/email not confirmed/i.test(error.message))       throw new Error('El usuario no está confirmado. Avisá al administrador.');
    throw new Error('No se pudo iniciar sesión: ' + error.message);
  }
  const profile = await loadProfile(data.user.id);
  if (!profile)         { await db.auth.signOut(); throw new Error('Tu usuario no tiene perfil asignado. Avisá al administrador.'); }
  if (!profile.active)  { await db.auth.signOut(); throw new Error('Tu usuario está desactivado.'); }
  _profile = profile;
  return _profile;
}

// Recarga el profile del usuario actual (refleja cambios de permisos sin re-login).
export async function refreshSession() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) { _profile = null; return null; }
  const profile = await loadProfile(user.id);
  if (!profile || !profile.active) { await db.auth.signOut(); _profile = null; return null; }
  _profile = profile;
  return _profile;
}

export async function logout() {
  await db.auth.signOut(); // el listener onAuthStateChange (app.js) recarga la página
  _profile = null;
}

export function isAdmin() { return _profile?.role === 'admin'; }

// ---- helper interno de permisos ----
function perm(col, defaultVal = false) {
  const s = _profile;
  if (!s) return false;
  if (s.role === 'admin') return true;
  return s[col] ?? defaultVal;
}

// ---- permisos generales ----
export function canSeeCost()      { return perm('can_see_cost'); }
export function canExportExcel()  { return perm('can_export_excel'); }

// ---- dashboard ----
export function canViewDashboard()   { return perm('can_view_dashboard', true); }

// ---- pedidos ----
export function canViewOrders()      { return perm('can_view_orders',   true); }
export function canCreateOrders()    { return perm('can_create_orders', true); }
export function canEditOrders()      { return perm('can_edit_orders',   true); }
export function canDeleteOrders()    { return perm('can_delete_orders', true); }

// ---- clientes ----
export function canViewClients()     { return perm('can_view_clients');   }
export function canCreateClients()   { return perm('can_create_clients'); }
export function canEditClients()     { return perm('can_edit_clients');   }
export function canDeleteClients()   { return perm('can_delete_clients'); }

// ---- productos ----
export function canViewProducts()    { return perm('can_view_products',   true); }
export function canCreateProducts()  { return perm('can_create_products'); }
export function canEditProducts()    { return perm('can_edit_products'); }
export function canDeleteProducts()  { return perm('can_delete_products'); }

// ---- proveedores ----
export function canViewProviders()    { return perm('can_view_providers',    true); }
export function canCreateProviders()  { return perm('can_create_providers',  true); }
export function canEditProviders()    { return perm('can_edit_providers',    true); }
export function canDeleteProviders()  { return perm('can_delete_providers',  true); }

// ---- reportes ----
export function canViewReports()     { return perm('can_view_reports', true); }
