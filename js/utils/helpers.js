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
// Guard opcional: función que devuelve true si se puede cerrar. Si devuelve
// false (ej. el usuario cancela "salir sin guardar"), el modal no se cierra.
let _modalGuard = null;

export function openModal(title, bodyHTML, { size = 'md', onClose, guard } = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const sizes = { sm: '420px', md: '620px', lg: '960px', xl: '1100px' };
  document.getElementById('modal-dialog').style.maxWidth = sizes[size] || sizes.md;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  _onModalClose = onClose || null;
  _modalGuard = guard || null;
}

// force=true cierra sin consultar el guard (ej. tras guardar correctamente).
// El guard puede ser síncrono (boolean) o asíncrono (Promise<boolean>), p. ej.
// cuando muestra un confirmDialog propio para "salir sin guardar".
export async function closeModal(force = false) {
  if (!force && _modalGuard) {
    const ok = await _modalGuard();
    if (!ok) return;
  }
  _modalGuard = null;
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
  if (_onModalClose) { _onModalClose(); _onModalClose = null; }
}

// --- Menú de acciones de la sección (drawer derecho del topbar) ---
// Cada módulo arma el contenido (HTML) y lo monta acá; aparece un botón en el
// topbar que abre el drawer (como el menú lateral, pero desde la derecha).
// Devuelve { close, setBadge } ; los botones del drawer mantienen sus onclick.
export function mountActionsMenu({ title = 'Acciones', bodyHTML = '' } = {}) {
  const wrap    = document.getElementById('topbar-actions');
  const drawer  = document.getElementById('actions-drawer');
  const overlay = document.getElementById('actions-drawer-overlay');
  const body    = document.getElementById('actions-drawer-body');
  const titleEl = document.getElementById('actions-drawer-title');
  if (!wrap || !drawer || !overlay || !body) return { close() {}, setBadge() {}, body: null };

  if (titleEl) titleEl.textContent = title;
  body.innerHTML = bodyHTML;
  wrap.innerHTML = `<span class="topbar-menu-wrap">
    <button class="icon-btn" id="topbar-menu-btn" title="Acciones" aria-label="Acciones"><i class="fas fa-ellipsis-vertical"></i></button>
    <span class="topbar-menu-badge hidden" id="topbar-menu-badge"></span>
  </span>`;

  const open  = () => { drawer.classList.add('open'); overlay.classList.remove('hidden'); };
  const close = () => { drawer.classList.remove('open'); overlay.classList.add('hidden'); };
  document.getElementById('topbar-menu-btn').onclick = open;
  drawer.querySelector('.actions-drawer-close').onclick = close;
  overlay.onclick = close;
  // Cerrar el drawer al tocar una acción puntual (las marcadas con data-close-menu).
  // Las interacciones del filtro NO la llevan, así no se cierra al tildar.
  body.onclick = e => { if (e.target.closest('[data-close-menu]')) close(); };

  const badge = document.getElementById('topbar-menu-badge');
  const setBadge = n => {
    if (!badge) return;
    if (n > 0) { badge.textContent = n; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  };

  return { close, setBadge, body };
}

// Limpia el menú de acciones (al cambiar de sección).
export function clearActionsMenu() {
  const wrap    = document.getElementById('topbar-actions');
  const overlay = document.getElementById('actions-drawer-overlay');
  const body    = document.getElementById('actions-drawer-body');
  document.getElementById('actions-drawer')?.classList.remove('open');
  if (wrap) wrap.innerHTML = '';
  if (body) body.innerHTML = '';
  overlay?.classList.add('hidden');
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

// Formatea un monto con el símbolo que se le pase (₲ por defecto).
// Ventas Totales va en guaraníes (₲); Ventas en Costo, en dólares ($).
export function fMoney(n, symbol = '₲') {
  return symbol + ' ' + new Intl.NumberFormat('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

export function fCurrency(n) {
  return fMoney(n, '₲');
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

// --- Confirm con diseño propio (reemplaza window.confirm) ---
// Devuelve una Promise<boolean>. Acepta un string (mensaje) o un objeto:
//   { title, message, confirmText, cancelText, danger, icon }
// Se monta por encima de cualquier modal abierto (z-index alto).
export function confirmDialog(opts = {}) {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  const {
    title = '¿Confirmar?',
    message = '',
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
    danger = false,
    icon = danger ? 'triangle-exclamation' : 'circle-question',
  } = o;

  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'cdialog-backdrop';
    back.innerHTML = `
      <div class="cdialog" role="alertdialog" aria-modal="true">
        <div class="cdialog-icon ${danger ? 'is-danger' : 'is-info'}">
          <i class="fas fa-${icon}"></i>
        </div>
        <h4 class="cdialog-title">${esc(title)}</h4>
        ${message ? `<p class="cdialog-msg">${esc(message)}</p>` : ''}
        <div class="cdialog-actions">
          <button type="button" class="btn btn-secondary cdialog-cancel">${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-accent'} cdialog-ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));

    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      back.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => back.remove(), 180);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    back.querySelector('.cdialog-cancel').onclick = () => close(false);
    back.querySelector('.cdialog-ok').onclick = () => close(true);
    back.addEventListener('mousedown', e => { if (e.target === back) close(false); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => back.querySelector('.cdialog-ok')?.focus(), 60);
  });
}

// Compat: las llamadas existentes pasan un mensaje (pregunta) corto. Lo
// mostramos como título del diálogo, con estética de acción destructiva.
export function confirm2(msg) {
  return confirmDialog({ title: msg, danger: true, confirmText: 'Sí', cancelText: 'No' });
}

// Diálogo con cuadro de texto (textarea). Devuelve Promise<string|null>:
// el texto ingresado (puede ser vacío) o null si se cancela/cierra.
export function promptDialog(opts = {}) {
  const {
    title = 'Escribí un texto',
    message = '',
    placeholder = '',
    value = '',
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
  } = opts;

  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'cdialog-backdrop';
    back.innerHTML = `
      <div class="cdialog" role="dialog" aria-modal="true">
        <h4 class="cdialog-title">${esc(title)}</h4>
        ${message ? `<p class="cdialog-msg">${esc(message)}</p>` : ''}
        <textarea class="form-control cdialog-input" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
        <div class="cdialog-actions">
          <button type="button" class="btn btn-secondary cdialog-cancel">${esc(cancelText)}</button>
          <button type="button" class="btn btn-accent cdialog-ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));

    const ta = back.querySelector('.cdialog-input');
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      back.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => back.remove(), 180);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    back.querySelector('.cdialog-cancel').onclick = () => close(null);
    back.querySelector('.cdialog-ok').onclick = () => close(ta.value);
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => ta.focus(), 60);
  });
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

// --- Traer TODAS las filas de una consulta (supera el límite de 1000 de Supabase) ---
// makeQuery() debe devolver una consulta NUEVA en cada llamada (con sus filtros/orden).
// Pagina de a 1000; si hay menos de 1000, hace una sola request (sin costo extra).
export async function fetchAllRows(makeQuery, pageSize = 1000) {
  let out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    if (!data || !data.length) break;
    out = out.concat(data);
    if (data.length < pageSize) break;   // última página
    from += pageSize;
  }
  return { data: out, error: null };
}

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
// onBeforeSort: callback opcional que se ejecuta antes de ordenar (ej. con
// render por tramos, fuerza a renderizar TODAS las filas para ordenarlas bien).
export function enableTableSort(table, { onBeforeSort } = {}) {
  if (!table || !table.tHead) return;
  const ths = [...table.tHead.rows[0].cells];
  ths.forEach((th, idx) => {
    if (!th.textContent.trim() || th.classList.contains('no-sort')) return;
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      if (onBeforeSort) onBeforeSort();
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

// --- Fila clicable: abrir el detalle tocando cualquier parte de la fila ---
// handler(id) recibe el data-id de la fila. Ignora clicks sobre controles
// (botones, links, inputs, estado) para no pisar sus propias acciones.
export function enableRowClick(table, handler) {
  if (!table || typeof handler !== 'function') return;
  table.classList.add('rows-clickable');
  table.addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, label, .status-btn')) return;
    const tr = e.target.closest('tbody tr');
    const id = tr?.dataset.id;
    if (id) handler(id);
  });
}

// --- Render por tramos (infinite scroll dentro de la tabla) ---
// En vez de inyectar miles de <tr> de una, va agregando filas a medida que se
// scrollea el contenedor (.table-responsive), usando un IntersectionObserver
// sobre la última fila renderizada. Mantiene todo en memoria para poder
// renderizar el resto al instante (ordenar, seleccionar todo).
//
// table:    <table> ya en el DOM, con <thead> y un <tbody> (se vacía).
// rowsHTML: array de strings; cada string es el/los <tr> de un ítem.
// Devuelve { renderAll } para forzar el render completo cuando haga falta.
export function lazyRenderRows(table, rowsHTML, { batch = 50, root } = {}) {
  const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
  tbody.innerHTML = '';
  const scroller = root || table.closest('.table-responsive') || table.parentElement;
  let i = 0;
  let onScroll = null;

  function appendNext() {
    if (i >= rowsHTML.length) return false;
    const end = Math.min(i + batch, rowsHTML.length);
    tbody.insertAdjacentHTML('beforeend', rowsHTML.slice(i, end).join(''));
    i = end;
    return true;
  }
  function stop() {
    if (onScroll && scroller) scroller.removeEventListener('scroll', onScroll);
    onScroll = null;
  }
  function renderAll() {
    stop();
    if (i < rowsHTML.length) {
      tbody.insertAdjacentHTML('beforeend', rowsHTML.slice(i).join(''));
      i = rowsHTML.length;
    }
  }
  // Mientras falte una pantalla para llegar al fondo, cargá el siguiente tramo.
  function topUp() {
    if (!scroller) { renderAll(); return; }
    let guard = 0;
    while (i < rowsHTML.length &&
           scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 350 &&
           guard++ < 200) {
      appendNext();
    }
    if (i >= rowsHTML.length) stop();
  }

  appendNext();            // primer tramo
  if (i < rowsHTML.length && scroller) {
    onScroll = () => topUp();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    topUp();               // rellena hasta que aparezca scroll (o se acabe)
  } else if (i < rowsHTML.length) {
    renderAll();
  }

  return { renderAll };
}

// --- Selección múltiple + eliminar en lote ---
// tableEl: la <table> que contiene un checkbox .chk-all en el encabezado
//          y un .row-chk[value="<id>"] por fila.
// bulkBtn: botón persistente (en la barra de acciones) que muestra
//          "Eliminar (N)" y dispara onDelete con los ids seleccionados.
// onDelete: async (ids[]) => { ...borra y recarga la lista... }
// Soporta varias filas con el mismo value (ej. un producto con varias
// filas de precio): se sincronizan y se cuentan como un solo registro.
export function enableBulkDelete(tableEl, bulkBtn, onDelete, { onBeforeSelectAll } = {}) {
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
    // Con render por tramos, "seleccionar todo" debe abarcar TODAS las filas:
    // forzamos el render completo antes de marcar.
    if (all.checked && onBeforeSelectAll) onBeforeSelectAll();
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

// --- Columnas redimensionables (con recorte en una sola línea vía CSS) ---
// Fija el ancho de las columnas y agrega una manija en cada encabezado
// para arrastrar y ensanchar la columna (y así ver el texto recortado).
// Soporta mouse y táctil (pointer events).
export function enableColumnResize(table) {
  if (!table || !table.tHead || !table.tHead.rows[0]) return;
  const container = table.parentElement;
  const ths = [...table.tHead.rows[0].cells];

  // Esperar un frame para medir el ancho ya renderizado (layout auto).
  requestAnimationFrame(() => {
    if (!table.isConnected) return;
    const widths = ths.map(th => th.offsetWidth);
    table.style.tableLayout = 'fixed';
    // La manija (.col-resizer) es absolute y necesita un th posicionado. En las
    // listas el th ya es position:sticky (encabezado fijo) — no lo pisamos; solo
    // ponemos relative cuando el th sigue siendo estático (ej. tablas de modal).
    ths.forEach((th, i) => {
      th.style.width = widths[i] + 'px';
      if (getComputedStyle(th).position === 'static') th.style.position = 'relative';
    });

    const fit = () => {
      const sum = ths.reduce((a, th) => a + (parseFloat(th.style.width) || th.offsetWidth), 0);
      table.style.width = Math.max(sum, container ? container.clientWidth : sum) + 'px';
    };
    fit();

    ths.forEach(th => {
      if (th.querySelector('.col-resizer')) return;
      const grip = document.createElement('span');
      grip.className = 'col-resizer';
      th.appendChild(grip);
      grip.addEventListener('click', ev => ev.stopPropagation()); // no disparar el ordenamiento
      grip.addEventListener('pointerdown', ev => {
        ev.preventDefault(); ev.stopPropagation();
        grip.setPointerCapture?.(ev.pointerId);
        const startX = ev.clientX;
        const startW = th.offsetWidth;
        const onMove = mv => { th.style.width = Math.max(48, startW + (mv.clientX - startX)) + 'px'; fit(); };
        const onUp = () => {
          grip.removeEventListener('pointermove', onMove);
          grip.removeEventListener('pointerup', onUp);
          document.body.style.userSelect = '';
        };
        document.body.style.userSelect = 'none';
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
      });
    });
  });
}
