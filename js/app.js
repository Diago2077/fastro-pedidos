// ============================================================
// FASTRO S.A. — App Entry Point
// ============================================================
import { db } from './supabase.js';
import { initAuth, login, logout, isAdmin,
  canViewDashboard, canViewOrders, canViewClients,
  canViewProducts, canViewProviders, canViewReports } from './auth.js';
import { avatarInitials, closeModal, toast, clearActionsMenu } from './utils/helpers.js';
import { loadSizeOrder } from './utils/sizes.js';
import { APP_VERSION } from './version.js';
import { renderDashboard }  from './modules/dashboard.js';
import { renderClients }    from './modules/clients.js';
import { renderProducts }   from './modules/products.js';
import { renderOrders }     from './modules/orders.js';
import { renderProviders }  from './modules/providers.js';
import { renderUsers }      from './modules/users.js';
import { renderReports }    from './modules/reports.js';
import { renderSettings }   from './modules/settings.js';
import { initPushForUser }  from './push.js';

// Tooltip global: muestra el texto completo de una celda recortada al pasar el mouse.
document.addEventListener('mouseover', e => {
  const cell = e.target.closest('.table td');
  if (!cell || cell.title) return;
  if (cell.scrollWidth > cell.clientWidth) cell.title = cell.textContent.trim();
}, { passive: true });

// ---- Section registry ----
const sections = {
  dashboard: { title: 'Dashboard',      render: renderDashboard,  permCheck: canViewDashboard },
  orders:    { title: 'Pedidos',         render: renderOrders,     permCheck: canViewOrders    },
  clients:   { title: 'Clientes',        render: renderClients,    permCheck: canViewClients   },
  products:  { title: 'Productos',       render: renderProducts,   permCheck: canViewProducts  },
  providers: { title: 'Proveedores',     render: renderProviders,  permCheck: canViewProviders },
  reports:   { title: 'Reportes',        render: renderReports,    permCheck: canViewReports   },
  users:     { title: 'Usuarios',        render: renderUsers,      permCheck: isAdmin          },
  settings:  { title: 'Configuración',   render: renderSettings,   permCheck: isAdmin          }
};

let currentSection = 'dashboard';

// ============================================================
// BOOT
// ============================================================
let _authReady = false;

// Si la sesión se cierra (logout o token vencido), volver al login.
// El guard _authReady evita recargas durante el arranque.
db.auth.onAuthStateChange((event) => {
  if (_authReady && event === 'SIGNED_OUT') window.location.reload();
});

document.addEventListener('DOMContentLoaded', async () => {
  const profile = await initAuth();
  if (profile) {
    await loadSizeOrder();   // orden de tallas centralizado (Configuración)
    showApp(profile);
  } else showLogin();
  _authReady = true;
});

// ============================================================
// LOGIN
// ============================================================
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn   = e.target.querySelector('[type=submit]');
    const email = document.getElementById('login-email').value;
    const pwd   = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ingresando…';

    try {
      const user = await login(email, pwd);
      showApp(user);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Ingresar';
    }
  });

  // Toggle password visibility
  document.getElementById('toggle-pwd')?.addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    const ico = document.querySelector('#toggle-pwd i');
    if (inp.type === 'password') { inp.type = 'text'; ico.className = 'fas fa-eye-slash'; }
    else { inp.type = 'password'; ico.className = 'fas fa-eye'; }
  });
}

// ============================================================
// APP
// ============================================================
function showApp(user) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // User info in sidebar
  document.getElementById('user-avatar').textContent = avatarInitials(user.name);
  document.getElementById('sidebar-user-name').textContent = user.name;
  document.getElementById('sidebar-user-role').textContent = user.role === 'admin' ? 'Administrador' : 'Usuario';

  // Versión + actualización (PWA)
  setupUpdateUI();

  // Notificaciones push: re-suscribe en silencio si ya hay permiso, o muestra
  // el cartel para activarlas. Funciona para TODOS los usuarios (no solo Admin).
  initPushForUser();

  // Show/hide nav items based on permissions
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    const section = link.dataset.section;
    const check = sections[section]?.permCheck;
    const allowed = !check || check();
    link.style.display = allowed ? '' : 'none';
  });

  // Ocultar la etiqueta de un grupo si ninguno de sus ítems quedó visible
  document.querySelectorAll('.sidebar-nav .nav-group').forEach(group => {
    const anyVisible = [...group.querySelectorAll('.nav-link[data-section]')]
      .some(l => l.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });

  // Sidebar navigation
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const section = link.dataset.section;
      const check = sections[section]?.permCheck;
      if (check && !check()) { toast('Acceso restringido', 'warning'); return; }
      navigate(section);
      closeSidebarMobile();
    });
  });

  // Drawer toggle (hamburguesa del header + botón "Más" de la barra inferior)
  document.getElementById('sidebar-open')?.addEventListener('click', openSidebarMobile);
  document.getElementById('bottom-more')?.addEventListener('click', openSidebarMobile);
  document.getElementById('sidebar-close')?.addEventListener('click', closeSidebarMobile);
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebarMobile);

  // Toggle de tema (claro/oscuro)
  syncThemeIcon();
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('fastro_theme', next); } catch (e) {}
    syncThemeIcon();
  });

  // Logout (signOut → onAuthStateChange recarga al login)
  document.getElementById('logout-btn')?.addEventListener('click', () => { logout(); });

  // Modal close (envuelto para no pasar el evento como argumento "force")
  document.getElementById('modal-close')?.addEventListener('click', () => closeModal());
  document.getElementById('modal-backdrop')?.addEventListener('click', () => closeModal());

  // Global closeModal
  window.closeModal = closeModal;

  // Initial section — fall back to first accessible if hash is restricted
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const target = sections[hash] ? hash : 'dashboard';
  const check = sections[target]?.permCheck;
  if (check && !check()) {
    const fallback = Object.keys(sections).find(k => !sections[k].permCheck || sections[k].permCheck());
    navigate(fallback || 'dashboard');
  } else {
    navigate(target);
  }
}

function navigate(section) {
  if (!sections[section]) return;
  const check = sections[section]?.permCheck;
  if (check && !check()) {
    toast('Acceso restringido', 'warning');
    return;
  }
  currentSection = section;

  // Update URL hash (no scroll)
  history.replaceState(null, '', '#' + section);

  // Update active nav link (sidebar + barra inferior comparten clase)
  document.querySelectorAll('.nav-link[data-section]').forEach(l => {
    l.classList.toggle('active', l.dataset.section === section);
  });

  // Resaltar "Más" cuando la sección actual no es uno de los tabs inferiores
  const bottomSections = [...document.querySelectorAll('.bottom-nav-link[data-section]')].map(l => l.dataset.section);
  document.getElementById('bottom-more')?.classList.toggle('active', !bottomSections.includes(section));

  // Update page title
  document.getElementById('page-title').textContent = sections[section].title;

  // Limpiar el menú de acciones de la sección anterior (cada módulo lo re-monta)
  clearActionsMenu();

  // Render section
  const content = document.getElementById('content-area');
  content.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i></div>`;
  sections[section].render(content);
}

// ============================================================
// VERSIÓN + ACTUALIZACIÓN (PWA)
// ============================================================
function setupUpdateUI() {
  // Mostrar la versión instalada
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;

  // Botón "Actualizar" del menú = forzar (borra caché + recarga)
  document.getElementById('force-update-btn')?.addEventListener('click', async () => {
    toast('Actualizando…');
    await window.AppUpdate?.force();
  });

  // Popup bloqueante cuando hay una versión nueva en espera: solo se puede
  // continuar tocando "Actualizar" (sin opción de descartar).
  const updateModal = document.getElementById('update-modal');
  const showUpdate = () => updateModal?.classList.remove('hidden');
  if (window.AppUpdate?.updateReady) showUpdate();
  window.addEventListener('fastro:update-available', showUpdate);

  const updateBtn = document.getElementById('update-now-btn');
  updateBtn?.addEventListener('click', () => {
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando…';
    window.AppUpdate?.applyWaiting();
  });
}

function syncThemeIcon() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = `<i class="fas fa-${dark ? 'sun' : 'moon'}"></i>`;
    btn.title = dark ? 'Modo claro' : 'Modo oscuro';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1115' : '#ffffff');
}

function openSidebarMobile() {
  document.getElementById('sidebar').classList.add('sidebar-open');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
}
function closeSidebarMobile() {
  document.getElementById('sidebar').classList.remove('sidebar-open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

// Handle browser back/forward
window.addEventListener('hashchange', () => {
  const section = window.location.hash.replace('#', '') || 'dashboard';
  if (sections[section] && section !== currentSection) navigate(section);
});
