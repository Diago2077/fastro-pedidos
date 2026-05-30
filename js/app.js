// ============================================================
// FASTRO S.A. — App Entry Point
// ============================================================
import { getSession, saveSession, clearSession, login, isAdmin, refreshSession,
  canViewDashboard, canViewOrders, canViewClients,
  canViewProducts, canViewProviders, canViewReports } from './auth.js';
import { avatarInitials, closeModal, toast } from './utils/helpers.js';
import { renderDashboard }  from './modules/dashboard.js';
import { renderClients }    from './modules/clients.js';
import { renderProducts }   from './modules/products.js';
import { renderOrders }     from './modules/orders.js';
import { renderProviders }  from './modules/providers.js';
import { renderUsers }      from './modules/users.js';
import { renderReports }    from './modules/reports.js';
import { renderSettings }   from './modules/settings.js';

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
document.addEventListener('DOMContentLoaded', async () => {
  const session = getSession();
  if (session) {
    const fresh = await refreshSession();
    if (fresh) {
      showApp(fresh);
    } else {
      clearSession();
      showLogin();
    }
  } else {
    showLogin();
  }
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
      saveSession(user);
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

  // Show/hide nav items based on permissions
  document.querySelectorAll('.nav-link[data-section]').forEach(link => {
    const section = link.dataset.section;
    const check = sections[section]?.permCheck;
    const allowed = !check || check();
    link.style.display = allowed ? '' : 'none';
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

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearSession(); window.location.reload();
  });

  // Modal close
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', closeModal);

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

  // Render section
  const content = document.getElementById('content-area');
  content.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i></div>`;
  sections[section].render(content);
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
