import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, confirmDialog, emptyState, loadingHTML, setLoading, debounce, fCurrency, fNum, fDate, statusBadge, esc, enableTableSort, enableColumnResize, lazyRenderRows, enableRowClick, mountActionsMenu, fetchAllRows } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';
import { sortSizes } from '../utils/sizes.js';
import { createMultiFilter } from '../utils/filters.js';
import { getSession, isAdmin, canExportExcel, canCreateOrders, canEditOrders, canDeleteOrders } from '../auth.js';

// In-memory state for order editing
let _state = {
  items: [],     // { variantId, code, description, color, size, qty, salePrice, costPrice }
  orderId: null
};
let _allOrders = [];

const STATUS_LABELS = { open: 'Abierto', sent: 'Enviado', closed: 'Cerrado' };
function nextStatus(s) { return { open: 'closed', closed: 'sent', sent: 'open' }[s] || 'open'; }
function todayISO() { return new Date().toISOString().split('T')[0]; }

// Contenido del botón de Estado del pedido (control con pista "Cambiar")
function statusBtnInner(s) {
  return `<span class="status-control-label">${STATUS_LABELS[s] || s}</span>
    <span class="status-control-hint"><i class="fas fa-sync-alt"></i> Cambiar</span>`;
}
function statusBtnClass(s) { return `status-btn status-control status-${s}`; }

// ---- Borrador automático de pedido NUEVO (localStorage) ----
// Sobrevive a cierres de pestaña, recargas o caídas para no perder el pedido.
const DRAFT_KEY = 'fastro_order_draft';
let _draftActive = false; // true mientras hay un modal de pedido NUEVO abierto

function readOrderDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
}
function clearOrderDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}
const persistOrderDraft = debounce(() => {
  if (!_draftActive) return;
  const g = id => document.getElementById(id);
  const draft = {
    client_id:    g('client-id-val')?.value || '',
    client_label: g('client-search')?.value || '',
    provider_id:  g('order-provider')?.value || '',
    season:       document.querySelector('#order-form [name=season]')?.value || '',
    discount_pct: g('discount-input')?.value || '0',
    shipping_date:g('order-shipping-date-val')?.value || '',
    status:       g('order-status-val')?.value || 'open',
    observation:  document.querySelector('#order-form [name=observation]')?.value || '',
    items:        _state.items,
    savedAt:      Date.now()
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
}, 600);

// Marca el pedido como modificado y agenda guardar el borrador
function orderChanged() { _state.dirty = true; persistOrderDraft(); }

// Etiqueta de cliente: "1024 — Juan Pérez (Tienda Centro)"
function clientLabel(c) {
  if (!c) return '';
  const code  = c.code != null ? `${c.code} — ` : '';
  const store = c.store_name ? ` (${c.store_name})` : '';
  return `${code}${c.name}${store}`;
}
// Normaliza texto para buscar (minúsculas, sin tildes)
function normTxt(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

export async function renderOrders(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="list-header">
          <div class="list-toolbar">
            <div class="search-box">
              <i class="fas fa-search"></i>
              <input type="text" id="q-ord" placeholder="Buscar por N° o cliente…" class="form-control">
            </div>
            ${canCreateOrders() ? `<button class="btn btn-accent" title="Nuevo pedido" onclick="window._ord.new()"><i class="fas fa-plus"></i></button>` : ''}
          </div>
        </div>
      </div>
      <div class="table-responsive" id="ord-tbl"></div>
    </div>`;

  // Menú de acciones (drawer derecho): filtros
  const _menu = mountActionsMenu({
    title: 'Acciones · Pedidos',
    bodyHTML: `
      <div class="menu-group-title"><i class="fas fa-filter"></i> Filtros</div>
      <div id="ord-filters"></div>`
  });

  let _totByOrder = {};

  // Filtro multi-selección (popover). El Estado es single-select (un estado a la
  // vez) y arranca en "Abierto": la tabla muestra solo los pedidos de ese estado.
  const _filterDefs = [{ key: 'status', label: 'Estado', dropdown: true, default: 'open' }];
  if (isAdmin()) _filterDefs.push({ key: 'seller', label: 'Vendedor', multi: true });
  _filterDefs.push({ key: 'season', label: 'Temporada', multi: true });

  const _filter = createMultiFilter({
    panel:  document.getElementById('ord-filters'),
    inline: true,
    defs:   _filterDefs,
    onChange: applyFilters
  });
  const _getters = {
    seller: o => o.users?.id || '',
    season: o => o.season || '',
    status: o => o.status || ''
  };

  async function load() {
    const tbl = document.getElementById('ord-tbl');
    if (tbl) tbl.innerHTML = loadingHTML();
    // Usuario normal: solo sus propios pedidos (la RLS también lo enforza en la base)
    const { data, error } = await fetchAllRows(() => {
      let q = db.from('orders')
        .select('id, order_number, status, season, discount_pct, created_at, shipping_date, clients(id, name), users:profiles(id, name), providers(name)')
        .order('created_at', { ascending: false });
      if (!isAdmin()) q = q.eq('user_id', getSession()?.id);
      return q;
    });
    if (error) { if (tbl) tbl.innerHTML = emptyState('Error al cargar pedidos'); toast('Error al cargar pedidos', 'error'); return; }
    _allOrders = data || [];

    // Totales por pedido (order_items también puede superar las 1000 filas)
    const { data: items } = await fetchAllRows(() => db.from('order_items').select('order_id, quantity, unit_sale_price'));
    _totByOrder = {};
    (items || []).forEach(i => { _totByOrder[i.order_id] = (_totByOrder[i.order_id] || 0) + i.quantity * i.unit_sale_price; });

    populateFilters();
    applyFilters();
  }

  // Rellena el filtro con los valores presentes (cliente/vendedor/temporada/estado)
  function populateFilters() {
    const sellers = new Map(), seasons = new Set();
    _allOrders.forEach(o => {
      if (o.users?.id) sellers.set(o.users.id, o.users.name);
      if (o.season)    seasons.add(o.season);
    });
    if (isAdmin()) _filter.setOptions('seller', [...sellers.entries()].sort((a, b) => String(a[1]).localeCompare(b[1])).map(([v, l]) => ({ value: v, label: l })));
    _filter.setOptions('season', [...seasons].sort().map(s => ({ value: s, label: s })));
    _filter.setOptions('status', [
      { value: 'open',   label: 'Abierto' },
      { value: 'sent',   label: 'Enviado' },
      { value: 'closed', label: 'Cerrado' },
      { value: '',       label: 'Todos' }
    ]);
    _filter.render();
  }

  function applyFilters() {
    const q = normTxt(document.getElementById('q-ord')?.value.trim() || '');

    let rows = _allOrders.filter(_filter.passes(_getters));
    if (q) rows = rows.filter(o => normTxt(o.order_number).includes(q) || normTxt(o.clients?.name).includes(q));

    // Indicador de filtros activos sobre el botón del menú
    _menu.setBadge(_filter.activeCount());

    render(rows, _totByOrder);
  }

  function render(rows, totByOrder = {}) {
    const el = document.getElementById('ord-tbl');
    if (!el) return;
    if (!rows.length) {
      const st = _filter.getSelected('status')[0];
      const stTxt = { open: ' abiertos', sent: ' enviados', closed: ' cerrados' }[st] || '';
      el.innerHTML = emptyState(`No hay pedidos${stTxt}`); return;
    }
    const rowsHTML = rows.map(o => {
      const sub = totByOrder[o.id] || 0;
      const tot = sub * (1 - (o.discount_pct || 0) / 100);
      return `<tr data-id="${o.id}">
        <td><strong>${esc(o.order_number)}</strong></td>
        <td>${fDate(o.created_at)}</td>
        <td>${esc(o.clients?.name || '–')}</td>
        <td><button class="status-btn status-${o.status}" onclick="window._ord.changeStatus('${o.id}','${o.status}')">${STATUS_LABELS[o.status] || o.status}</button></td>
        <td>${fCurrency(tot)}</td>
        <td>${esc(o.users?.name || '–')}</td>
      </tr>`;
    });

    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>N° Pedido</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th><th>Vendedor</th></tr></thead>
      <tbody></tbody>
    </table>`;
    const table = el.querySelector('table');
    const lazy = lazyRenderRows(table, rowsHTML);
    enableTableSort(table, { onBeforeSort: lazy.renderAll });
    enableColumnResize(table);
    enableRowClick(table, id => window._ord.open(id));
  }

  // Use Object.assign so updateQty / removeItem defined at module level are not overwritten
  Object.assign(window._ord = window._ord || {}, {
    new() { openOrderModal(null, () => load()); },
    open(id) { openOrderModal(id, () => load()); },
    async del(id) {
      if (!await confirm2('¿Eliminar este pedido definitivamente?')) return;
      const { error } = await db.from('orders').delete().eq('id', id);
      if (error) { toast('Error al eliminar: ' + error.message, 'error'); return; }
      toast('Pedido eliminado'); closeModal(true); load();
    },
    async changeStatus(id, current) {
      const next = nextStatus(current);
      // Solo el Admin puede pasar de Cerrado→Enviado y de Enviado→Abierto.
      const adminOnly = (current === 'closed' && next === 'sent') || (current === 'sent' && next === 'open');
      if (adminOnly && !isAdmin()) {
        toast('Solo un administrador puede hacer este cambio de estado', 'warning');
        return;
      }
      if (!await confirm2(`¿Cambiar estado a "${STATUS_LABELS[next]}"?`)) return;
      const update = { status: next, updated_at: new Date().toISOString() };
      if (next === 'sent') update.shipping_date = todayISO();
      const { error } = await db.from('orders').update(update).eq('id', id);
      if (error) { toast('No se pudo cambiar el estado: ' + error.message, 'error'); return; }
      toast(`Estado: ${STATUS_LABELS[next]}`);
      load();
    }
  });

  document.getElementById('q-ord')?.addEventListener('input', debounce(applyFilters, 250));

  load();
}

// ============================================================
// ORDER MODAL (create / edit)
// ============================================================
async function openOrderModal(orderId, onSavedFn) {
  _state = { items: [], orderId, dirty: false };

  // Parallel data fetch
  const [clientsRes, provsRes, cfgRes] = await Promise.all([
    db.from('clients').select('id, code, name, store_name').eq('active', true).order('name'),
    db.from('providers').select('id, name').eq('active', true).order('name'),
    db.from('app_config').select('key, value')
  ]);

  const clients   = clientsRes.data || [];
  const providers = provsRes.data  || [];
  const cfg       = Object.fromEntries((cfgRes.data || []).map(r => [r.key, r.value]));

  let order = { season: cfg.current_season || '', discount_pct: 0, status: 'open' };
  if (orderId) {
    const { data } = await db.from('orders').select('*').eq('id', orderId).single();
    order = data || order;
    // Load existing items
    const { data: existing } = await db
      .from('order_items')
      .select('id, quantity, unit_sale_price, unit_cost_price, product_variants(id, color, size, products(id, code, description))')
      .eq('order_id', orderId);
    _state.items = (existing || []).map(i => ({
      itemId:      i.id,
      variantId:   i.product_variants?.id,
      code:        i.product_variants?.products?.code || '',
      description: i.product_variants?.products?.description || '',
      color:       i.product_variants?.color || '',
      size:        i.product_variants?.size  || '',
      qty:         i.quantity,
      salePrice:   i.unit_sale_price,
      costPrice:   i.unit_cost_price
    }));
  }

  // Enviado/Cerrado = solo lectura (lo usa renderItemsTable para los ítems)
  _state.locked = order.status === 'sent' || order.status === 'closed';

  const html = buildOrderFormHTML(order, clients, providers, orderId);

  // Aviso del navegador si se cierra la pestaña / recarga con cambios sin guardar
  const beforeUnload = (e) => { if (_state.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  _draftActive = !orderId; // solo se guardan borradores de pedidos NUEVOS

  openModal(orderId ? `Pedido ${order.order_number}` : 'Nuevo Pedido', html, {
    size: 'xl',
    // Avisar antes de cerrar (X / Cancelar / fondo) si hay cambios sin guardar
    guard: () => !_state.dirty || confirmDialog({
      title: 'Cambios sin guardar',
      message: 'Tenés productos agregados al pedido que se perderán si salís sin guardar.',
      confirmText: 'Salir sin guardar',
      cancelText: 'Seguir editando',
      danger: true,
    }),
    onClose: () => {
      window.removeEventListener('beforeunload', beforeUnload);
      // Cierre deliberado de un pedido NUEVO (guardar o confirmar salida): el
      // borrador ya no aplica. Si la app se cae sin pasar por acá, queda para recuperar.
      // En pedidos existentes NO se toca el borrador (puede haber uno nuevo pendiente).
      if (!orderId) { _draftActive = false; clearOrderDraft(); }
    }
  });

  // Marcar el pedido como "modificado" y guardar borrador ante cualquier cambio
  document.getElementById('order-form')?.addEventListener('input',  orderChanged);
  document.getElementById('order-form')?.addEventListener('change', orderChanged);

  // Restaurar valores del borrador al formulario ya montado
  function restoreDraft(d) {
    const g = id => document.getElementById(id);
    if (g('client-id-val'))  g('client-id-val').value  = d.client_id || '';
    if (g('client-search'))  g('client-search').value  = d.client_label || '';
    if (g('order-provider')) g('order-provider').value = d.provider_id || '';
    const seasonEl = document.querySelector('#order-form [name=season]'); if (seasonEl) seasonEl.value = d.season || '';
    if (g('discount-input'))          g('discount-input').value          = d.discount_pct ?? 0;
    if (g('order-shipping-date-val')) g('order-shipping-date-val').value = d.shipping_date || '';
    if (g('order-status-val'))        g('order-status-val').value        = d.status || 'open';
    const obsEl = document.querySelector('#order-form [name=observation]'); if (obsEl) obsEl.value = d.observation || '';
    const sbtn = g('order-status-btn');
    if (sbtn) { const s = d.status || 'open'; sbtn.className = statusBtnClass(s); sbtn.innerHTML = statusBtnInner(s); }
    _state.items = Array.isArray(d.items) ? d.items : [];
    _state.dirty = true;
    _prevProvider = d.provider_id || '';
    renderItemsTable();
    updateTotals();
    syncProductSearchState();
    toast('Pedido sin terminar recuperado', 'info');
  }

  // Render items table
  renderItemsTable();
  updateTotals();

  // Client search autocomplete (busca por código, nombre o tienda)
  const clientSearch  = document.getElementById('client-search');
  const clientResults = document.getElementById('client-results');
  const clientIdVal   = document.getElementById('client-id-val');

  function renderClientResults(list) {
    if (!list.length) {
      clientResults.innerHTML = '<div class="sr-item text-muted">Sin resultados</div>';
    } else {
      clientResults.innerHTML = list.slice(0, 20).map(c =>
        `<div class="sr-item" data-id="${c.id}">${esc(clientLabel(c))}</div>`).join('');
    }
    clientResults.classList.remove('hidden');
  }

  clientSearch?.addEventListener('input', () => {
    clientIdVal.value = ''; // al editar el texto se anula la selección previa
    const q = normTxt(clientSearch.value.trim());
    if (!q) { clientResults.classList.add('hidden'); return; }
    const matches = clients.filter(c => normTxt(`${c.code ?? ''} ${c.name} ${c.store_name ?? ''}`).includes(q));
    renderClientResults(matches);
  });

  clientSearch?.addEventListener('focus', () => {
    if (!clientIdVal.value && clientSearch.value.trim()) clientSearch.dispatchEvent(new Event('input'));
  });

  clientResults?.addEventListener('click', e => {
    const item = e.target.closest('.sr-item[data-id]');
    if (!item) return;
    const c = clients.find(x => x.id === item.dataset.id);
    if (c) { clientIdVal.value = c.id; clientSearch.value = clientLabel(c); }
    clientResults.classList.add('hidden');
  });

  // Ocultar resultados al perder foco (con delay para que registre el click)
  clientSearch?.addEventListener('blur', () => setTimeout(() => clientResults?.classList.add('hidden'), 150));

  // Product search autocomplete
  const searchInput = document.getElementById('prod-search');
  const searchResults = document.getElementById('prod-results');

  searchInput?.addEventListener('input', debounce(async e => {
    const q = e.target.value.trim();
    if (q.length < 2) { searchResults.classList.add('hidden'); return; }
    const providerId = document.getElementById('order-provider')?.value;
    if (!providerId) {
      searchResults.innerHTML = '<div class="sr-item text-muted">Seleccioná un proveedor primero</div>';
      searchResults.classList.remove('hidden');
      return;
    }
    const { data, error } = await db.from('products')
      .select('id, code, description, product_variants(id, color, size, sale_price, cost_price, created_at)')
      .eq('active', true)
      .eq('provider_id', providerId)
      .or(`code.ilike.%${q}%,description.ilike.%${q}%`)
      .limit(10);
    if (error) { searchResults.innerHTML = '<div class="sr-item text-muted">Error al buscar productos</div>'; searchResults.classList.remove('hidden'); return; }
    if (!data?.length) { searchResults.innerHTML = '<div class="sr-item text-muted">Sin resultados para este proveedor</div>'; searchResults.classList.remove('hidden'); return; }
    searchResults.innerHTML = data.map(p => `
      <div class="sr-item" data-id="${p.id}" data-code="${esc(p.code)}" data-desc="${esc(p.description)}">
        <strong>${esc(p.code)}</strong> — ${esc(p.description)}
      </div>`).join('');
    searchResults.classList.remove('hidden');

    // Store variants data for later
    searchResults._productMap = Object.fromEntries(data.map(p => [p.id, p]));
  }, 250));

  // Botón "X" para limpiar la búsqueda rápido
  const searchClear = document.getElementById('prod-search-clear');
  const toggleSearchClear = () => searchClear?.classList.toggle('hidden', !searchInput?.value);
  searchInput?.addEventListener('input', toggleSearchClear);
  searchClear?.addEventListener('click', () => {
    if (!searchInput) return;
    searchInput.value = '';
    searchResults?.classList.add('hidden');
    toggleSearchClear();
    searchInput.focus();
  });

  searchResults?.addEventListener('click', e => {
    const item = e.target.closest('.sr-item[data-id]');
    if (!item) return;
    const productId = item.dataset.id;
    const product   = searchResults._productMap?.[productId];
    if (product) showProductGrid(product);
    searchInput.value = `${item.dataset.code} — ${item.dataset.desc}`;
    searchResults.classList.add('hidden');
    toggleSearchClear();
  });

  // Dismiss results on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#prod-search-wrap')) searchResults?.classList.add('hidden');
  }, { once: true });

  // El buscador de productos se habilita solo con un proveedor elegido,
  // y muestra únicamente productos de ese proveedor.
  const providerSelect = document.getElementById('order-provider');
  function syncProductSearchState() {
    if (!searchInput) return;
    const hasProv = !!providerSelect?.value;
    searchInput.disabled = !hasProv;
    searchInput.placeholder = hasProv
      ? 'Buscar producto por código o descripción…'
      : 'Primero seleccioná un proveedor';
  }
  syncProductSearchState();

  let _prevProvider = providerSelect?.value || '';
  providerSelect?.addEventListener('change', async () => {
    const newVal = providerSelect.value;
    // Un pedido pertenece a un solo proveedor: si ya hay ítems, avisar antes de vaciarlos
    if (_state.items.length && newVal !== _prevProvider) {
      const ok = await confirm2('Cambiar de proveedor quitará los productos ya agregados al pedido. ¿Continuar?');
      if (!ok) { providerSelect.value = _prevProvider; return; }
      _state.items = [];
      orderChanged();
      renderItemsTable();
      updateTotals();
    }
    _prevProvider = newVal;
    if (searchInput) searchInput.value = '';
    searchResults?.classList.add('hidden');
    const gridWrap = document.getElementById('product-grid-wrap');
    if (gridWrap) gridWrap.innerHTML = '';
    syncProductSearchState();
  });

  // Popup "Agregar Productos": botón abre / X y backdrop cierran
  const prodPicker = document.getElementById('prod-picker');
  const prodPickerBackdrop = document.getElementById('prod-picker-backdrop');
  function openProdPicker() {
    if (!providerSelect?.value) {
      toast('Seleccioná un proveedor primero', 'warning');
      providerSelect?.focus();
      return;
    }
    prodPicker?.classList.remove('hidden');
    prodPickerBackdrop?.classList.remove('hidden');
    setTimeout(() => searchInput?.focus(), 50);
  }
  function closeProdPicker() {
    prodPicker?.classList.add('hidden');
    prodPickerBackdrop?.classList.add('hidden');
    if (searchInput) searchInput.value = '';
    searchResults?.classList.add('hidden');
    document.getElementById('prod-search-clear')?.classList.add('hidden');
    const gw = document.getElementById('product-grid-wrap');
    if (gw) gw.innerHTML = '';
  }
  document.getElementById('btn-open-prod-picker')?.addEventListener('click', openProdPicker);
  document.getElementById('prod-picker-close')?.addEventListener('click', closeProdPicker);
  prodPickerBackdrop?.addEventListener('click', closeProdPicker);

  // Status button — cycle with confirmation
  // Ciclo: Abierto → Cerrado → Enviado → Abierto.
  document.getElementById('order-status-btn')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('order-status-val');
    const current = statusEl.value;
    const next = nextStatus(current);

    // Solo el Admin puede pasar de Cerrado→Enviado y de Enviado→Abierto.
    const adminOnly = (current === 'closed' && next === 'sent') || (current === 'sent' && next === 'open');
    if (adminOnly && !isAdmin()) {
      toast('Solo un administrador puede hacer este cambio de estado', 'warning');
      return;
    }

    if (!await confirm2(`¿Cambiar estado a "${STATUS_LABELS[next]}"?`)) return;

    // Pedido nuevo (sin guardar aún): el estado queda en el formulario y se
    // guarda al tocar "Guardar". No hay nada que bloquear todavía.
    if (!orderId) {
      statusEl.value = next;
      const btn = document.getElementById('order-status-btn');
      btn.className = statusBtnClass(next);
      btn.innerHTML = statusBtnInner(next);
      if (next === 'sent') document.getElementById('order-shipping-date-val').value = todayISO();
      return;
    }

    // Pedido existente: dejar el nuevo estado en el form y persistirlo al instante.
    statusEl.value = next;
    if (next === 'sent') document.getElementById('order-shipping-date-val').value = todayISO();

    let ok;
    if (_state.dirty) {
      // Había cambios sin guardar (pedido editable): guardar todo, incluido el estado.
      ok = !!(await saveOrder(order, orderId, onSavedFn, { keepOpen: true }));
    } else {
      const payload = { status: next, updated_at: new Date().toISOString() };
      if (next === 'sent') payload.shipping_date = todayISO();
      const { error } = await db.from('orders').update(payload).eq('id', orderId);
      if (error) { toast('No se pudo guardar el estado: ' + error.message, 'error'); statusEl.value = current; return; }
      if (onSavedFn) onSavedFn();
      ok = true;
    }
    if (!ok) { statusEl.value = current; return; }

    toast(`Estado cambiado a "${STATUS_LABELS[next]}"`, 'success');
    // Re-abrir el pedido para reflejar el bloqueo/desbloqueo de la edición.
    window.removeEventListener('beforeunload', beforeUnload);
    window._ord.open(orderId);
  });

  // Form submit
  document.getElementById('order-form')?.addEventListener('submit', e => {
    e.preventDefault();
    saveOrder(order, orderId, onSavedFn);
  });

  // Si hay cambios sin guardar, los guarda antes de exportar (el PDF/Excel se arma
  // desde la BD). Devuelve false si el guardado falla, para abortar la exportación.
  async function ensureSavedBeforeExport() {
    if (!_state.dirty) return true;
    const saved = await saveOrder(order, orderId, onSavedFn, { keepOpen: true });
    return !!saved;
  }

  // Print PDF
  document.getElementById('btn-print-order')?.addEventListener('click', async () => {
    if (!orderId) { toast('Guarda el pedido primero para imprimir', 'warning'); return; }
    const btn = document.getElementById('btn-print-order');
    setLoading(btn, true);
    try {
      if (!await ensureSavedBeforeExport()) return;
      await exportOrderPDF(orderId);
    }
    catch (e) { toast('Error al generar PDF: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  });

  // Export Excel
  document.getElementById('btn-excel-order')?.addEventListener('click', async () => {
    if (!orderId) { toast('Guarda el pedido primero para exportar', 'warning'); return; }
    const btn = document.getElementById('btn-excel-order');
    setLoading(btn, true);
    try {
      if (!await ensureSavedBeforeExport()) return;
      await exportOrderExcel(orderId);
    }
    catch (e) { toast('Error al exportar: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  });

  // ¿Hay un borrador de un pedido nuevo sin terminar? Ofrecer recuperarlo.
  // (al final, cuando ya está todo el formulario cableado)
  if (_draftActive) {
    const draft = readOrderDraft();
    if (draft && Array.isArray(draft.items) && draft.items.length) {
      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString('es-PY') : '';
      if (await confirm2(`Encontramos un pedido sin terminar (${draft.items.length} producto/s${when ? ` · ${when}` : ''}). ¿Recuperarlo?`)) {
        restoreDraft(draft);
      } else {
        clearOrderDraft();
      }
    }
  }
}

function buildOrderFormHTML(order, clients, providers, orderId) {
  const providerOpts = providers.map(p => `<option value="${p.id}" ${order.provider_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const selectedClient = clients.find(c => c.id === order.client_id);

  // Pedido Enviado o Cerrado = solo lectura. Para editar hay que volverlo a Abierto.
  const locked = order.status === 'sent' || order.status === 'closed';
  const dis = locked ? 'disabled' : '';
  const lockNote = locked ? `
    <div class="order-locked-note">
      <i class="fas fa-lock"></i>
      Pedido <strong>${STATUS_LABELS[order.status]}</strong>: solo lectura. Cambiá el estado a <strong>Abierto</strong> para editar.
    </div>` : '';

  return `
  <form id="order-form">
    ${lockNote}
    <!-- HEADER -->
    <div class="order-header-grid">
      <div class="form-group" id="client-search-wrap" style="position:relative">
        <label class="form-label req">Cliente</label>
        <input type="hidden" name="client_id" id="client-id-val" value="${order.client_id || ''}">
        <div class="search-box">
          <i class="fas fa-search"></i>
          <input type="text" id="client-search" class="form-control" autocomplete="off" ${dis}
            placeholder="Buscar por código, nombre o tienda…" value="${esc(clientLabel(selectedClient))}">
        </div>
        <div id="client-results" class="search-results hidden"></div>
      </div>
      <div class="form-group">
        <label class="form-label req">Proveedor</label>
        <select name="provider_id" id="order-provider" class="form-control" required ${dis}>
          <option value="">— Seleccionar —</option>
          ${providerOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Temporada</label>
        <input type="text" name="season" class="form-control" value="${esc(order.season || '')}" ${dis}>
      </div>
    </div>
    <input type="hidden" name="shipping_date" id="order-shipping-date-val" value="${order.shipping_date || ''}">
    <input type="hidden" name="status" id="order-status-val" value="${order.status || 'open'}">

    <!-- ORDER ITEMS TABLE -->
    <div class="section-divider"><i class="fas fa-list"></i> Ítems del Pedido <span id="items-summary" class="items-summary"></span></div>
    <div class="table-responsive" id="items-tbl"></div>
    ${locked ? '' : `<button type="button" id="btn-open-prod-picker" class="btn-add-products">
      <i class="fas fa-plus"></i> Agregar Productos
    </button>`}

    <!-- OBSERVACIÓN -->
    <div class="form-group mt-3">
      <label class="form-label">Observación</label>
      <textarea name="observation" class="form-control" rows="2" ${dis}>${esc(order.observation || '')}</textarea>
    </div>

    <!-- TOTALES (barra fija al pie del modal) -->
    <div class="order-totals-bar">
      <div class="otb-discount">
        <label class="form-label" for="discount-input">Descuento (%)</label>
        <input type="number" name="discount_pct" class="form-control" min="0" max="100" step="0.1"
          value="${order.discount_pct || 0}" id="discount-input" ${dis}>
      </div>
      <span class="otb-cell">Subtotal <strong id="tot-sub">$0.00</strong></span>
      <span class="otb-cell">Descuento (<span id="tot-disc-pct">0</span>%) <strong id="tot-disc">-$0.00</strong></span>
      <span class="otb-cell otb-total">TOTAL <strong id="tot-final">$0.00</strong></span>
    </div>

    <!-- FOOTER -->
    <div class="form-footer">
      ${(orderId && canDeleteOrders()) ? `<button type="button" class="btn btn-danger-outline" title="Eliminar" onclick="window._ord.del('${orderId}')"><i class="fas fa-trash"></i></button>` : ''}
      <button type="button" class="btn btn-outline" id="btn-print-order" title="Imprimir / PDF"><i class="fas fa-file-pdf"></i></button>
      ${canExportExcel() ? `<button type="button" class="btn btn-outline" id="btn-excel-order" title="Exportar Excel"><i class="fas fa-file-excel"></i></button>` : ''}
      <button type="button" id="order-status-btn" class="${statusBtnClass(order.status || 'open')}" style="margin-left:auto">
        ${statusBtnInner(order.status || 'open')}
      </button>
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      ${(!locked && (orderId ? canEditOrders() : canCreateOrders())) ? `<button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar</button>` : ''}
    </div>

    <!-- POPUP: Agregar Productos (buscador + grilla de variantes) -->
    <div id="prod-picker-backdrop" class="prod-picker-backdrop hidden"></div>
    <div id="prod-picker" class="prod-picker hidden">
      <div class="prod-picker-dialog">
        <div class="prod-picker-header">
          <h4><i class="fas fa-search"></i> Agregar Productos</h4>
          <button type="button" class="icon-btn" id="prod-picker-close" aria-label="Cerrar"><i class="fas fa-times"></i></button>
        </div>
        <div class="prod-picker-body">
          <div id="prod-search-wrap" style="position:relative">
            <div class="search-box">
              <i class="fas fa-search"></i>
              <input type="text" id="prod-search" class="form-control" placeholder="Buscar producto por código o descripción…" autocomplete="off">
              <button type="button" id="prod-search-clear" class="search-clear hidden" aria-label="Limpiar búsqueda"><i class="fas fa-times"></i></button>
            </div>
            <div id="prod-results" class="search-results hidden"></div>
          </div>
          <div id="product-grid-wrap"></div>
        </div>
      </div>
    </div>
  </form>`;
}

// ============================================================
// PRODUCT GRID
// ============================================================
function showProductGrid(product) {
  const wrap = document.getElementById('product-grid-wrap');
  if (!wrap) return;

  // Sort variants by creation order to preserve the order defined when the product was created
  const variants = [...(product.product_variants || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Tallas según el orden definido en Configuración; colores en orden de creación
  const sizes  = sortSizes([...new Map(variants.map(v => [v.size,  v])).keys()]);
  const colors = [...new Map(variants.map(v => [v.color, v])).keys()];

  const variantMap = {};
  variants.forEach(v => { variantMap[`${v.color}|||${v.size}`] = v; });

  const priceRow = sizes.map(s => {
    const anyVar = variants.find(v => v.size === s);
    return `<th class="text-center"><div>${esc(s)}</div><div class="sz-price">${fNum(anyVar?.sale_price || 0)}</div></th>`;
  }).join('');

  // Build a lookup of existing quantities already in the order
  const existingQtyMap = {};
  _state.items.forEach(item => { existingQtyMap[item.variantId] = item.qty; });

  const bodyRows = colors.map(color => {
    const cells = sizes.map(size => {
      const v = variantMap[`${color}|||${size}`];
      if (!v) return `<td class="cell-na">–</td>`;
      const existingQty = existingQtyMap[v.id] || '';
      const inputStyle  = existingQty ? 'style="border-color:var(--accent);background:#fff8f8"' : '';
      return `<td class="text-center">
        <div class="qty-stepper">
          <button type="button" class="qty-btn" data-act="dec" tabindex="-1">−</button>
          <input type="number" min="0" class="form-control form-control-sm grid-qty text-center"
            data-variant-id="${v.id}" data-code="${esc(product.code)}" data-desc="${esc(product.description)}"
            data-color="${esc(color)}" data-size="${esc(size)}"
            data-sale="${v.sale_price}" data-cost="${v.cost_price}"
            value="${existingQty}" placeholder="0" ${inputStyle}>
          <button type="button" class="qty-btn" data-act="inc" tabindex="-1">+</button>
        </div>
      </td>`;
    }).join('');
    return `<tr><td><strong>${esc(color)}</strong></td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="product-grid-card">
      <div class="product-grid-title">
        <strong>${esc(product.code)}</strong> — ${esc(product.description)}
        <button type="button" class="btn btn-xs btn-danger-outline float-end" id="btn-close-grid"><i class="fas fa-times"></i></button>
      </div>
      <div class="table-responsive">
        <table class="table table-bordered table-sm product-grid-table">
          <thead><tr><th>Color</th>${priceRow}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <div class="text-end mt-2">
        <button type="button" class="btn btn-accent btn-sm" id="btn-add-to-order">
          <i class="fas fa-cart-plus"></i> Agregar al Pedido
        </button>
      </div>
    </div>`;

  document.getElementById('btn-close-grid')?.addEventListener('click', () => { wrap.innerHTML = ''; });

  // Botones +/- por celda (delegado en la tabla recién creada, sin acumular listeners)
  wrap.querySelector('.product-grid-table')?.addEventListener('click', e => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    const input = btn.parentElement.querySelector('.grid-qty');
    if (!input) return;
    let val = parseInt(input.value) || 0;
    val = btn.dataset.act === 'inc' ? val + 1 : Math.max(0, val - 1);
    input.value = val > 0 ? val : ''; // vacío en 0 para mostrar el placeholder
    // resaltar mientras tenga cantidad
    if (val > 0) { input.style.borderColor = 'var(--accent)'; input.style.background = '#fff8f8'; }
    else { input.style.borderColor = ''; input.style.background = ''; }
  });

  document.getElementById('btn-add-to-order')?.addEventListener('click', () => {
    const allInputs = [...wrap.querySelectorAll('.grid-qty')];
    let added = 0, removed = 0;

    allInputs.forEach(inp => {
      const qty       = parseInt(inp.value) || 0;
      const variantId = inp.dataset.variantId;
      const hadItem   = _state.items.some(item => item.variantId === variantId);

      // Always remove the existing entry for this variant first
      _state.items = _state.items.filter(item => item.variantId !== variantId);

      if (qty > 0) {
        _state.items.push({
          variantId,
          code:        inp.dataset.code,
          description: inp.dataset.desc,
          color:       inp.dataset.color,
          size:        inp.dataset.size,
          qty,
          salePrice:   parseFloat(inp.dataset.sale),
          costPrice:   parseFloat(inp.dataset.cost)
        });
        added++;
      } else if (hadItem) {
        removed++; // was in order, now set to 0 → deleted
      }
    });

    if (added === 0 && removed === 0) { toast('Ingresa al menos una cantidad', 'warning'); return; }

    orderChanged();
    renderItemsTable();
    updateTotals();
    wrap.innerHTML = '';
    // Limpiar la búsqueda y dejar el foco listo para el siguiente producto
    const ps = document.getElementById('prod-search');
    if (ps) { ps.value = ''; ps.focus(); }
    document.getElementById('prod-results')?.classList.add('hidden');
    document.getElementById('prod-search-clear')?.classList.add('hidden');

    if (added > 0 && removed > 0) toast(`${added} variante(s) actualizadas, ${removed} eliminada(s)`, 'success');
    else if (added > 0)            toast(`${added} variante(s) agregadas al pedido`, 'success');
    else                           toast(`${removed} variante(s) eliminadas del pedido`, 'info');
  });
}

// ============================================================
// ITEMS TABLE
// ============================================================
function renderItemsTable() {
  const el = document.getElementById('items-tbl');
  if (!el) return;
  // Resumen: cantidad de ítems y unidades totales
  const sumEl = document.getElementById('items-summary');
  if (sumEl) {
    const units = _state.items.reduce((a, i) => a + i.qty, 0);
    sumEl.textContent = _state.items.length ? `· ${_state.items.length} ítems · ${units} u.` : '';
  }
  if (!_state.items.length) { el.innerHTML = emptyState('No hay productos en este pedido'); return; }
  const locked = _state.locked;
  el.innerHTML = `<table class="table table-sm table-bordered">
    <thead><tr><th>Código</th><th>Descripción</th><th>Color</th><th>Talla</th><th class="text-center">Cant.</th><th class="text-end">P.Venta</th><th class="text-end">Subtotal</th><th></th></tr></thead>
    <tbody>
      ${_state.items.map((item, idx) => `<tr>
        <td>${esc(item.code)}</td>
        <td>${esc(item.description)}</td>
        <td>${esc(item.color)}</td>
        <td>${esc(item.size)}</td>
        <td class="text-center">${locked ? `<strong>${item.qty}</strong>` : `
          <div class="qty-stepper">
            <button type="button" class="qty-btn" tabindex="-1" onclick="window._ord.stepQty(${idx}, -1)">−</button>
            <input type="number" min="1" value="${item.qty}" class="form-control form-control-sm grid-qty text-center"
              onchange="window._ord.updateQty(${idx}, this.value)">
            <button type="button" class="qty-btn" tabindex="-1" onclick="window._ord.stepQty(${idx}, 1)">+</button>
          </div>`}
        </td>
        <td class="text-end">${fCurrency(item.salePrice)}</td>
        <td class="text-end">${fCurrency(item.qty * item.salePrice)}</td>
        <td>${locked ? '' : `<button type="button" class="btn btn-xs btn-danger-outline" onclick="window._ord.removeItem(${idx})"><i class="fas fa-times"></i></button>`}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
  const table = el.querySelector('table');
  enableColumnResize(table);

  // Mostrar como máximo 5 filas; el resto se ve con scroll. Medimos el alto real
  // (encabezado + 5 filas) para que el corte sea exacto aunque las filas varíen.
  const MAX_VISIBLE = 5;
  const bodyRows = table.tBodies[0]?.rows || [];
  if (bodyRows.length > MAX_VISIBLE) {
    let h = table.tHead ? table.tHead.offsetHeight : 0;
    for (let i = 0; i < MAX_VISIBLE; i++) h += bodyRows[i].offsetHeight;
    el.style.maxHeight = (h + 2) + 'px';
  } else {
    el.style.maxHeight = 'none';
  }
}

function updateTotals() {
  const sub   = _state.items.reduce((acc, i) => acc + i.qty * i.salePrice, 0);
  const disc  = parseFloat(document.getElementById('discount-input')?.value || 0);
  const discAmt = sub * (disc / 100);
  const total = sub - discAmt;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('tot-sub', fCurrency(sub));
  set('tot-disc-pct', disc.toFixed(1));
  set('tot-disc', '-' + fCurrency(discAmt));
  set('tot-final', fCurrency(total));
}

document.addEventListener('input', e => {
  if (e.target.id === 'discount-input') updateTotals();
});

// Exposed methods for inline event handlers
window._ord = window._ord || {};
Object.assign(window._ord, {
  updateQty(idx, val) {
    if (_state.items[idx]) { _state.items[idx].qty = Math.max(1, parseInt(val) || 1); orderChanged(); renderItemsTable(); updateTotals(); }
  },
  stepQty(idx, delta) {
    if (_state.items[idx]) { _state.items[idx].qty = Math.max(1, (parseInt(_state.items[idx].qty) || 1) + delta); orderChanged(); renderItemsTable(); updateTotals(); }
  },
  removeItem(idx) { _state.items.splice(idx, 1); orderChanged(); renderItemsTable(); updateTotals(); }
});

// ============================================================
// SAVE ORDER
// ============================================================
// keepOpen=true: guarda sin cerrar el modal (usado por el auto-guardado antes de
// exportar PDF/Excel). Devuelve el id del pedido si guardó bien, o null si falló.
async function saveOrder(originalOrder, orderId, onSavedFn, { keepOpen = false } = {}) {
  const form = document.getElementById('order-form');
  const btn  = form.querySelector('[type=submit]');
  setLoading(btn, true);

  const fd = new FormData(form);

  // El cliente se elige con un buscador (input oculto), así que validamos manualmente
  if (!fd.get('client_id')) {
    setLoading(btn, false);
    toast('Seleccioná un cliente de la lista', 'warning');
    document.getElementById('client-search')?.focus();
    return null;
  }

  if (!fd.get('provider_id')) {
    setLoading(btn, false);
    toast('Seleccioná un proveedor', 'warning');
    document.getElementById('order-provider')?.focus();
    return null;
  }

  if (!_state.items.length) {
    setLoading(btn, false);
    toast('Agregá al menos un producto al pedido', 'warning');
    document.getElementById('prod-search')?.focus();
    return null;
  }

  const payload = {
    client_id:    fd.get('client_id')    || null,
    provider_id:  fd.get('provider_id')  || null,
    season:       fd.get('season')       || null,
    discount_pct: parseFloat(fd.get('discount_pct')) || 0,
    shipping_date: fd.get('shipping_date') || (fd.get('status') === 'sent' ? todayISO() : null),
    status:       fd.get('status'),
    observation:  fd.get('observation')  || null,
    updated_at:   new Date().toISOString()
  };

  try {
    let finalOrderId = orderId;

    if (orderId) {
      const { error } = await db.from('orders').update(payload).eq('id', orderId);
      if (error) throw error;
    } else {
      const session = getSession();
      const { data, error } = await db.from('orders')
        .insert({ ...payload, user_id: session?.id })
        .select('id').single();
      if (error) throw error;
      finalOrderId = data.id;
    }

    // Replace order items: delete all then re-insert
    await db.from('order_items').delete().eq('order_id', finalOrderId);

    if (_state.items.length) {
      const itemPayloads = _state.items.map(i => ({
        order_id:           finalOrderId,
        product_variant_id: i.variantId,
        quantity:           i.qty,
        unit_sale_price:    i.salePrice,
        unit_cost_price:    i.costPrice
      }));
      const { error } = await db.from('order_items').insert(itemPayloads);
      if (error) throw error;
    }

    _state.dirty = false;
    if (onSavedFn) onSavedFn();
    if (keepOpen) {
      toast('Pedido guardado');     // auto-guardado antes de exportar: el modal sigue abierto
    } else {
      toast(orderId ? 'Pedido actualizado' : 'Pedido creado');
      closeModal(true);   // forzar: ya se guardó, no preguntar
    }
    return finalOrderId;
  } catch (err) {
    toast('Error: ' + err.message, 'error');
    return null;
  } finally {
    setLoading(btn, false);
  }
}

// ============================================================
// PDF / EXCEL EXPORT FOR AN ORDER
// ============================================================

// jsPDF default font (Helvetica) doesn't support ₲ — use "Gs." instead
function fGs(n) {
  return 'Gs. ' + new Intl.NumberFormat('es-PY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
}

export async function exportOrderPDF(orderId) {
  const { data: order } = await db.from('orders')
    .select('*, clients(*), users:profiles(name)')
    .eq('id', orderId).single();
  const { data: items } = await db.from('order_items')
    .select('quantity, unit_sale_price, unit_cost_price, product_variants(color, size, products(code, description))')
    .eq('order_id', orderId);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const sub   = (items || []).reduce((a, i) => a + i.quantity * i.unit_sale_price, 0);
  const disc  = sub * ((order.discount_pct || 0) / 100);
  const total = sub - disc;

  // Header
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, 210, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text('FASTRO S.A.', 14, 12);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('PEDIDO DE COMPRA', 14, 19);
  doc.text(order.order_number, 196, 12, { align: 'right' });
  doc.text(new Date(order.created_at).toLocaleDateString('es-PY'), 196, 19, { align: 'right' });

  // Info block (2 columns, no proveedor)
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  const infoY = 30;
  doc.text(`Cliente:   ${order.clients?.name  || '–'}`, 14, infoY);
  doc.text(`RUC:       ${order.clients?.ruc   || '–'}`, 14, infoY + 5);
  doc.text(`Telefono:  ${order.clients?.phone || '–'}`, 14, infoY + 10);
  doc.text(`Vendedor:  ${order.users?.name    || '–'}`, 110, infoY);
  doc.text(`Temporada: ${order.season         || '–'}`, 110, infoY + 5);
  doc.text(`Envio:     ${order.shipping_date  ? fDate(order.shipping_date) : '–'}`, 110, infoY + 10);

  doc.autoTable({
    startY: infoY + 18,
    head: [['Codigo', 'Descripcion', 'Color', 'Talla', 'Cant.', 'P.Venta', 'Subtotal']],
    body: (items || []).map(i => [
      i.product_variants?.products?.code        || '–',
      i.product_variants?.products?.description || '–',
      i.product_variants?.color || '–',
      i.product_variants?.size  || '–',
      i.quantity,
      fGs(i.unit_sale_price),
      fGs(i.quantity * i.unit_sale_price)
    ]),
    headStyles: { fillColor: [155, 0, 0] },
    foot: [
      ['', '', '', '', '', 'Subtotal',                      fGs(sub)],
      ['', '', '', '', '', `Descuento (${order.discount_pct || 0}%)`, '-' + fGs(disc)],
      ['', '', '', '', '', 'TOTAL',                         fGs(total)]
    ],
    footStyles: { fontStyle: 'bold' },
    styles: { fontSize: 8 }
  });

  if (order.observation) {
    const finalY = doc.lastAutoTable.finalY + 6;
    doc.setFontSize(8);
    doc.text(`Observacion: ${order.observation}`, 14, finalY);
  }

  doc.save(`${order.order_number}.pdf`);
}

export async function exportOrderExcel(orderId) {
  const { data: order } = await db.from('orders')
    .select('*, clients(*), users:profiles(name), providers(name)')
    .eq('id', orderId).single();
  const { data: items } = await db.from('order_items')
    .select('quantity, unit_sale_price, unit_cost_price, product_variants(color, size, products(code, description))')
    .eq('order_id', orderId);

  const sub  = (items || []).reduce((a, i) => a + i.quantity * i.unit_sale_price, 0);
  const disc = sub * ((order.discount_pct || 0) / 100);
  const total = sub - disc;

  const header = ['Código', 'Descripción', 'Color', 'Talla', 'Cantidad', 'P.Venta', 'P.Costo', 'Subtotal'];
  const rows = (items || []).map(i => [
    i.product_variants?.products?.code        || '–',
    i.product_variants?.products?.description || '–',
    i.product_variants?.color || '–',
    i.product_variants?.size  || '–',
    i.quantity,
    i.unit_sale_price,
    i.unit_cost_price,
    i.quantity * i.unit_sale_price
  ]);

  // Info block at top
  const info = [
    [`Pedido: ${order.order_number}`],
    [`Cliente: ${order.clients?.name || '–'}`],
    [`Proveedor: ${order.providers?.name || '–'}`],
    [`Vendedor: ${order.users?.name || '–'}`],
    [`Temporada: ${order.season || '–'}`],
    [],
    header,
    ...rows,
    [],
    ['', '', '', '', '', '', 'Subtotal', sub],
    ['', '', '', '', '', '', `Descuento (${order.discount_pct || 0}%)`, -disc],
    ['', '', '', '', '', '', 'TOTAL', total]
  ];

  const ws = window.XLSX.utils.aoa_to_sheet(info);
  ws['!cols'] = [12, 22, 10, 8, 10, 10, 10, 12].map(w => ({ wch: w }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, order.order_number);
  window.XLSX.writeFile(wb, `${order.order_number}.xlsx`);
}
