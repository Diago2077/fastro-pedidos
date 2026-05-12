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

// ---- helpers internos ----
function perm(col, defaultVal = false) {
  const s = getSession();
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
export function canEditProducts()    { return perm('can_edit_products'); }
export function canDeleteProducts()  { return perm('can_delete_products'); }

// ---- proveedores ----
export function canViewProviders()    { return perm('can_view_providers',    true); }
export function canCreateProviders()  { return perm('can_create_providers',  true); }
export function canEditProviders()    { return perm('can_edit_providers',    true); }
export function canDeleteProviders()  { return perm('can_delete_providers',  true); }

// ---- reportes ----
export function canViewReports()     { return perm('can_view_reports', true); }

const USER_SELECT = `id, name, email, role, active,
  can_see_cost, can_export_excel,
  can_view_dashboard,
  can_view_orders, can_create_orders, can_edit_orders, can_delete_orders,
  can_view_clients, can_create_clients, can_edit_clients, can_delete_clients,
  can_view_products, can_edit_products, can_delete_products,
  can_view_providers, can_create_providers, can_edit_providers, can_delete_providers,
  can_view_reports`;

export async function login(email, password) {
  const hash = await hashPwd(password);
  const { data, error } = await db
    .from('users')
    .select(USER_SELECT)
    .eq('email', email.toLowerCase().trim())
    .eq('password_hash', hash)
    .eq('active', true)
    .maybeSingle();

  if (error) throw new Error('Error de conexión con la base de datos');
  if (!data) throw new Error('Correo o contraseña incorrectos');
  return data;
}

export async function refreshSession() {
  const session = getSession();
  if (!session?.id) return null;
  const { data, error } = await db
    .from('users')
    .select(USER_SELECT)
    .eq('id', session.id)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) {
    // Columns may not exist yet (pending migration) — keep existing session
    return session;
  }
  const remember = !!localStorage.getItem('fastro_user');
  saveSession(data, remember);
  return data;
}

export function logout() {
  clearSession();
  window.location.reload();
}
