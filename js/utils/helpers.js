// ============================================================
// HELPERS GLOBALES
// ============================================================

// --- Toast notifications ---
export function toast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i><span>${message}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// --- Modal ---
let _onModalClose = null;

export function openModal(title, bodyHTML, { size = 'md', onClose } = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const sizes = { sm: '420px', md: '620px', lg: '960px', xl: '1100px' };
  document.getElementById('modal-dialog').style.maxWidth = sizes[size] || sizes.md;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  _onModalClose = onClose || null;
}

export function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
  if (_onModalClose) { _onModalClose(); _onModalClose = null; }
}

// --- Date / Currency formatters ---
export function fDate(d) {
  if (!d) return '–';
  return new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fDateTime(d) {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fCurrency(n) {
  return '₲ ' + new Intl.NumberFormat('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

export function fNum(n) {
  return (n || 0).toLocaleString('es-EC');
}

// --- Status badge ---
export function statusBadge(s) {
  const m = { open: ['Abierto', 'info'], closed: ['Cerrado', 'warning'], sent: ['Enviado', 'success'] };
  const [label, type] = m[s] || [s, 'secondary'];
  return `<span class="badge badge-${type}">${label}</span>`;
}

// --- Password hash (SHA-256 via Web Crypto) ---
export async function hashPwd(password) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Confirm ---
export function confirm2(msg) {
  return new Promise(r => r(window.confirm(msg)));
}

// --- Loading button ---
export function setLoading(btn, on) {
  if (on) { btn.disabled = true; btn._orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  else { btn.disabled = false; btn.innerHTML = btn._orig || btn.innerHTML; }
}

// --- Empty state ---
export function emptyState(msg = 'Sin registros') {
  return `<div class="empty-state"><i class="fas fa-inbox"></i><p>${msg}</p></div>`;
}

// --- Today YYYY-MM-DD ---
export function today() { return new Date().toISOString().split('T')[0]; }

// --- Debounce ---
export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// --- Get form data as object ---
export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// --- Avatar initials ---
export function avatarInitials(name = '') {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

// --- Escape HTML ---
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Ordenar tablas tocando el encabezado ---
// Detecta números, moneda (₲ 120.000), fechas dd/mm/aaaa y texto.
function _cellSortValue(td) {
  if (td.dataset && td.dataset.sort !== undefined) {
    const n = parseFloat(td.dataset.sort);
    return isNaN(n) ? String(td.dataset.sort).toLowerCase() : n;
  }
  const txt = (td.textContent || '').trim();
  if (!txt || txt === '–') return '';
  const dm = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dm) { const y = dm[3].length === 2 ? '20' + dm[3] : dm[3]; return new Date(+y, +dm[2] - 1, +dm[1]).getTime(); }
  if (/\d/.test(txt) && /^[₲$\s.,\d%–-]+$/.test(txt)) {
    const num = txt.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = parseFloat(num);
    if (!isNaN(n)) return n;
  }
  return txt.toLowerCase();
}

// Habilita el ordenamiento por click en los <th> de una tabla.
// Las columnas vacías (acciones) o con clase .no-sort se omiten.
export function enableTableSort(table) {
  if (!table || !table.tHead) return;
  const ths = [...table.tHead.rows[0].cells];
  ths.forEach((th, idx) => {
    if (!th.textContent.trim() || th.classList.contains('no-sort')) return;
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      ths.forEach(h => { h.removeAttribute('data-dir'); h.querySelectorAll('.sort-arrow').forEach(a => a.remove()); });
      th.dataset.dir = dir;
      const tbody = table.tBodies[0];
      if (!tbody) return;
      [...tbody.rows]
        .sort((ra, rb) => {
          const va = _cellSortValue(ra.cells[idx]);
          const vb = _cellSortValue(rb.cells[idx]);
          const c = (typeof va === 'number' && typeof vb === 'number')
            ? va - vb
            : String(va).localeCompare(String(vb), 'es', { numeric: true });
          return dir === 'asc' ? c : -c;
        })
        .forEach(r => tbody.appendChild(r));
      th.insertAdjacentHTML('beforeend', `<span class="sort-arrow"> ${dir === 'asc' ? '▲' : '▼'}</span>`);
    });
  });
}
