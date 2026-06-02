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
  return new Date(d.includes('T') ? d : d + 'T12:00:00').toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fDateTime(d) {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fCurrency(n) {
  return '₲ ' + new Intl.NumberFormat('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

export function fNum(n) {
  return (n || 0).toLocaleString('es-PY');
}

// --- Status badge ---
export function statusBadge(s) {
  const m = { open: ['Abierto', 'info'], closed: ['Cerrado', 'warning'], sent: ['Enviado', 'success'] };
  const [label, type] = m[s] || [s, 'secondary'];
  return `<span class="badge badge-${type}">${label}</span>`;
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

// --- Loading spinner (para inyectar mientras carga una lista) ---
export function loadingHTML(msg = 'Cargando…') {
  return `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i><span class="sr-only">${msg}</span></div>`;
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

// --- Selección múltiple + eliminar en lote ---
// tableEl: la <table> que contiene un checkbox .chk-all en el encabezado
//          y un .row-chk[value="<id>"] por fila.
// bulkBtn: botón persistente (en la barra de acciones) que muestra
//          "Eliminar (N)" y dispara onDelete con los ids seleccionados.
// onDelete: async (ids[]) => { ...borra y recarga la lista... }
// Soporta varias filas con el mismo value (ej. un producto con varias
// filas de precio): se sincronizan y se cuentan como un solo registro.
export function enableBulkDelete(tableEl, bulkBtn, onDelete) {
  if (!tableEl || !bulkBtn) return;
  const all = tableEl.querySelector('.chk-all');
  const rowChks = () => [...tableEl.querySelectorAll('.row-chk')];
  const distinct = () => [...new Set(rowChks().filter(c => c.checked).map(c => c.value))];

  function refresh() {
    const sel = distinct();
    bulkBtn.style.display = sel.length ? '' : 'none';
    bulkBtn.innerHTML = `<i class="fas fa-trash"></i> Eliminar (${sel.length})`;
    if (all) {
      const total = new Set(rowChks().map(c => c.value)).size;
      all.checked = sel.length > 0 && sel.length === total;
      all.indeterminate = sel.length > 0 && sel.length < total;
    }
  }

  all?.addEventListener('change', () => {
    rowChks().forEach(c => { c.checked = all.checked; });
    refresh();
  });

  tableEl.addEventListener('change', e => {
    const chk = e.target.closest('.row-chk');
    if (!chk) return;
    // sincronizar filas que comparten el mismo registro
    tableEl.querySelectorAll(`.row-chk[value="${CSS.escape(chk.value)}"]`).forEach(c => { c.checked = chk.checked; });
    refresh();
  });

  bulkBtn.onclick = async () => {
    const ids = distinct();
    if (!ids.length) return;
    if (!await confirm2(`¿Eliminar ${ids.length} registro(s)? Esta acción no se puede deshacer.`)) return;
    await onDelete(ids);
  };

  refresh();
}
