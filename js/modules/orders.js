import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, debounce, fCurrency, fDate, statusBadge, esc } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';
import { getSession, canExportExcel, canCreateOrders, canEditOrders, canDeleteOrders } from '../auth.js';

// In-memory state for order editing
let _state = {
  items: [],     // { variantId, code, description, color, size, qty, salePrice, costPrice }
  orderId: null
};
let _allOrders = [];

const STATUS_LABELS = { open: 'Abierto', sent: 'Enviado', closed: 'Cerrado' };
function nextStatus(s) { return { open: 'closed', closed: 'sent', sent: 'open' }[s] || 'open'; }
function todayISO() { return new Date().toISOString().split('T')[0]; }

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
        <div class="card-actions">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input type="text" id="q-ord" placeholder="Buscar por N° o cliente…" class="form-control">
          </div>
          <select id="filter-status" class="form-control form-control-sm" style="width:auto">
            <option value="">Todos los estados</option>
            <option value="open">Abiertos</option>
            <option value="closed">Cerrados</option>
            <option value="sent">Enviados</option>
          </select>
          ${canCreateOrders() ? `<button class="btn btn-accent" onclick="window._ord.new()"><i class="fas fa-plus"></i> Nuevo Pedido</button>` : ''}
        </div>
      </div>
      <div class="table-responsive" id="ord-tbl"></div>
    </div>`;

  async function load(q = '', status = '') {
    let query = db.from('orders')
      .select('id, order_number, status, season, discount_pct, created_at, shipping_date, clients(name), users:profiles(name), providers(name)')
      .order('created_at', { ascending: false });
    if (q) query = query.or(`order_number.ilike.%${q}%`);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) { toast('Error al cargar pedidos', 'error'); return; }
    _allOrders = data || [];

    // Fetch totals per order
    const { data: items } = await db.from('order_items').select('order_id, quantity, unit_sale_price');
    const totByOrder = {};
    (items || []).forEach(i => { totByOrder[i.order_id] = (totByOrder[i.order_id] || 0) + i.quantity * i.unit_sale_price; });

    render(_allOrders, totByOrder);
  }

  function render(rows, totByOrder = {}) {
    const el = document.getElementById('ord-tbl');
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState('No hay pedidos'); return; }
    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>N° Pedido</th><th>Cliente</th><th>Vendedor</th><th>Proveedor</th><th>Temporada</th><th>Total</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>
      <tbody>
        ${rows.map(o => {
          const sub = totByOrder[o.id] || 0;
          const tot = sub * (1 - (o.discount_pct || 0) / 100);
          return `<tr>
            <td><strong>${esc(o.order_number)}</strong></td>
            <td>${esc(o.clients?.name || '–')}</td>
            <td>${esc(o.users?.name || '–')}</td>
            <td>${esc(o.providers?.name || '–')}</td>
            <td>${esc(o.season || '–')}</td>
            <td>${fCurrency(tot)}</td>
            <td><button class="status-btn status-${o.status}" onclick="window._ord.changeStatus('${o.id}','${o.status}')">${STATUS_LABELS[o.status] || o.status}</button></td>
            <td>${fDate(o.created_at)}</td>
            <td class="td-actions">
              <button class="btn btn-xs btn-outline" title="Ver / Editar" onclick="window._ord.open('${o.id}')"><i class="fas fa-eye"></i></button>
              ${canDeleteOrders() ? `<button class="btn btn-xs btn-danger-outline" title="Eliminar" onclick="window._ord.del('${o.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  // Use Object.assign so updateQty / removeItem defined at module level are not overwritten
  Object.assign(window._ord = window._ord || {}, {
    new() { openOrderModal(null, () => load()); },
    open(id) { openOrderModal(id, () => load()); },
    async del(id) {
      if (!await confirm2('¿Eliminar este pedido definitivamente?')) return;
      await db.from('orders').delete().eq('id', id);
      toast('Pedido eliminado'); load();
    },
    async changeStatus(id, current) {
      const next = nextStatus(current);
      if (!await confirm2(`¿Cambiar estado a "${STATUS_LABELS[next]}"?`)) return;
      const update = { status: next, updated_at: new Date().toISOString() };
      if (next === 'sent') update.shipping_date = todayISO();
      await db.from('orders').update(update).eq('id', id);
      toast(`Estado: ${STATUS_LABELS[next]}`);
      load();
    }
  });

  document.getElementById('q-ord')?.addEventListener('input', debounce(e => {
    load(e.target.value.trim(), document.getElementById('filter-status').value);
  }, 300));
  document.getElementById('filter-status')?.addEventListener('change', e => {
    load(document.getElementById('q-ord').value.trim(), e.target.value);
  });

  load();
}

// ============================================================
// ORDER MODAL (create / edit)
// ============================================================
async function openOrderModal(orderId, onSavedFn) {
  _state = { items: [], orderId };

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

  const html = buildOrderFormHTML(order, clients, providers, orderId);
  openModal(orderId ? `Pedido ${order.order_number}` : 'Nuevo Pedido', html, { size: 'xl' });

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
    const { data } = await db.from('products')
      .select('id, code, description, product_variants(id, color, size, sale_price, cost_price, created_at)')
      .eq('active', true)
      .or(`code.ilike.%${q}%,description.ilike.%${q}%`)
      .limit(10);
    if (!data?.length) { searchResults.innerHTML = '<div class="sr-item text-muted">Sin resultados</div>'; searchResults.classList.remove('hidden'); return; }
    searchResults.innerHTML = data.map(p => `
      <div class="sr-item" data-id="${p.id}" data-code="${esc(p.code)}" data-desc="${esc(p.description)}">
        <strong>${esc(p.code)}</strong> — ${esc(p.description)}
      </div>`).join('');
    searchResults.classList.remove('hidden');

    // Store variants data for later
    searchResults._productMap = Object.fromEntries(data.map(p => [p.id, p]));
  }, 250));

  searchResults?.addEventListener('click', e => {
    const item = e.target.closest('.sr-item[data-id]');
    if (!item) return;
    const productId = item.dataset.id;
    const product   = searchResults._productMap?.[productId];
    if (product) showProductGrid(product);
    searchInput.value = `${item.dataset.code} — ${item.dataset.desc}`;
    searchResults.classList.add('hidden');
  });

  // Dismiss results on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#prod-search-wrap')) searchResults?.classList.add('hidden');
  }, { once: true });

  // Status button — cycle with confirmation
  document.getElementById('order-status-btn')?.addEventListener('click', async () => {
    const current = document.getElementById('order-status-val').value;
    const next = nextStatus(current);
    if (!await confirm2(`¿Cambiar estado a "${STATUS_LABELS[next]}"?`)) return;
    document.getElementById('order-status-val').value = next;
    const btn = document.getElementById('order-status-btn');
    btn.className = `status-btn status-${next}`;
    btn.innerHTML = `${STATUS_LABELS[next]} <i class="fas fa-sync-alt fa-xs" style="margin-left:5px;opacity:.5"></i>`;
    if (next === 'sent') document.getElementById('order-shipping-date-val').value = todayISO();
  });

  // Form submit
  document.getElementById('order-form')?.addEventListener('submit', e => {
    e.preventDefault();
    saveOrder(order, orderId, onSavedFn);
  });

  // Print PDF
  document.getElementById('btn-print-order')?.addEventListener('click', async () => {
    if (!orderId) { toast('Guarda el pedido primero para imprimir', 'warning'); return; }
    const btn = document.getElementById('btn-print-order');
    setLoading(btn, true);
    try { await exportOrderPDF(orderId); }
    catch (e) { toast('Error al generar PDF: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  });

  // Export Excel
  document.getElementById('btn-excel-order')?.addEventListener('click', async () => {
    if (!orderId) { toast('Guarda el pedido primero para exportar', 'warning'); return; }
    const btn = document.getElementById('btn-excel-order');
    setLoading(btn, true);
    try { await exportOrderExcel(orderId); }
    catch (e) { toast('Error al exportar: ' + e.message, 'error'); }
    finally { setLoading(btn, false); }
  });
}

function buildOrderFormHTML(order, clients, providers, orderId) {
  const providerOpts = providers.map(p => `<option value="${p.id}" ${order.provider_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const selectedClient = clients.find(c => c.id === order.client_id);

  return `
  <form id="order-form">
    <!-- HEADER -->
    <div class="order-header-grid">
      ${orderId ? `<div class="form-group"><label class="form-label">N° Pedido</label>
        <input class="form-control" value="${esc(order.order_number || '')}" readonly></div>` : ''}
      <div class="form-group" id="client-search-wrap" style="position:relative">
        <label class="form-label req">Cliente</label>
        <input type="hidden" name="client_id" id="client-id-val" value="${order.client_id || ''}">
        <div class="search-box">
          <i class="fas fa-search"></i>
          <input type="text" id="client-search" class="form-control" autocomplete="off"
            placeholder="Buscar por código, nombre o tienda…" value="${esc(clientLabel(selectedClient))}">
        </div>
        <div id="client-results" class="search-results hidden"></div>
      </div>
      <div class="form-group">
        <label class="form-label req">Proveedor</label>
        <select name="provider_id" class="form-control" required>
          <option value="">— Seleccionar —</option>
          ${providerOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Temporada</label>
        <input type="text" name="season" class="form-control" value="${esc(order.season || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Descuento (%)</label>
        <input type="number" name="discount_pct" class="form-control" min="0" max="100" step="0.1"
          value="${order.discount_pct || 0}" id="discount-input">
      </div>
      <input type="hidden" name="shipping_date" id="order-shipping-date-val" value="${order.shipping_date || ''}">
      <input type="hidden" name="status" id="order-status-val" value="${order.status || 'open'}">
      <div class="form-group">
        <label class="form-label">Estado</label>
        <button type="button" id="order-status-btn" class="status-btn status-${order.status || 'open'}">
          ${STATUS_LABELS[order.status || 'open']} <i class="fas fa-sync-alt fa-xs" style="margin-left:5px;opacity:.5"></i>
        </button>
      </div>
    </div>

    <!-- PRODUCT SEARCH -->
    <div class="section-divider"><i class="fas fa-search"></i> Agregar Productos</div>
    <div id="prod-search-wrap" style="position:relative;margin-bottom:12px">
      <div class="search-box">
        <i class="fas fa-search"></i>
        <input type="text" id="prod-search" class="form-control" placeholder="Buscar producto por código o descripción…" autocomplete="off">
      </div>
      <div id="prod-results" class="search-results hidden"></div>
    </div>

    <!-- PRODUCT GRID (shown after selection) -->
    <div id="product-grid-wrap"></div>

    <!-- ORDER ITEMS TABLE -->
    <div class="section-divider"><i class="fas fa-list"></i> Ítems del Pedido</div>
    <div class="table-responsive" id="items-tbl"></div>

    <!-- TOTALS -->
    <div class="order-totals">
      <div class="totals-row"><span>Subtotal</span><span id="tot-sub">$0.00</span></div>
      <div class="totals-row"><span>Descuento (<span id="tot-disc-pct">0</span>%)</span><span id="tot-disc">-$0.00</span></div>
      <div class="totals-row totals-final"><span>TOTAL</span><span id="tot-final">$0.00</span></div>
    </div>

    <!-- OBSERVACIÓN -->
    <div class="form-group mt-3">
      <label class="form-label">Observación</label>
      <textarea name="observation" class="form-control" rows="2">${esc(order.observation || '')}</textarea>
    </div>

    <!-- FOOTER -->
    <div class="form-footer">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn btn-outline" id="btn-print-order"><i class="fas fa-file-pdf"></i> Imprimir</button>
      ${canExportExcel() ? `<button type="button" class="btn btn-outline" id="btn-excel-order"><i class="fas fa-file-excel"></i> Excel</button>` : ''}
      ${(orderId ? canEditOrders() : canCreateOrders()) ? `<button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar Pedido</button>` : ''}
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

  // Unique sizes and colors in creation order (no alphabetical sort)
  const sizes  = [...new Map(variants.map(v => [v.size,  v])).keys()];
  const colors = [...new Map(variants.map(v => [v.color, v])).keys()];

  const variantMap = {};
  variants.forEach(v => { variantMap[`${v.color}|||${v.size}`] = v; });

  const priceRow = sizes.map(s => {
    const anyVar = variants.find(v => v.size === s);
    return `<th class="text-center"><div>${esc(s)}</div><div class="sz-price">${fCurrency(anyVar?.sale_price || 0)}</div></th>`;
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

    renderItemsTable();
    updateTotals();
    wrap.innerHTML = '';
    document.getElementById('prod-search').value = '';

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
  if (!_state.items.length) { el.innerHTML = emptyState('No hay productos en este pedido'); return; }
  el.innerHTML = `<table class="table table-sm table-bordered">
    <thead><tr><th>Código</th><th>Descripción</th><th>Color</th><th>Talla</th><th>Cant.</th><th>P.Venta</th><th>Subtotal</th><th></th></tr></thead>
    <tbody>
      ${_state.items.map((item, idx) => `<tr>
        <td>${esc(item.code)}</td>
        <td>${esc(item.description)}</td>
        <td>${esc(item.color)}</td>
        <td>${esc(item.size)}</td>
        <td>
          <input type="number" min="1" value="${item.qty}" class="form-control form-control-sm text-center"
            style="width:70px" onchange="window._ord.updateQty(${idx}, this.value)">
        </td>
        <td>${fCurrency(item.salePrice)}</td>
        <td>${fCurrency(item.qty * item.salePrice)}</td>
        <td><button type="button" class="btn btn-xs btn-danger-outline" onclick="window._ord.removeItem(${idx})"><i class="fas fa-times"></i></button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
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
    if (_state.items[idx]) { _state.items[idx].qty = Math.max(1, parseInt(val) || 1); renderItemsTable(); updateTotals(); }
  },
  removeItem(idx) { _state.items.splice(idx, 1); renderItemsTable(); updateTotals(); }
});

// ============================================================
// SAVE ORDER
// ============================================================
async function saveOrder(originalOrder, orderId, onSavedFn) {
  const form = document.getElementById('order-form');
  const btn  = form.querySelector('[type=submit]');
  setLoading(btn, true);

  const fd = new FormData(form);

  // El cliente se elige con un buscador (input oculto), así que validamos manualmente
  if (!fd.get('client_id')) {
    setLoading(btn, false);
    toast('Seleccioná un cliente de la lista', 'warning');
    document.getElementById('client-search')?.focus();
    return;
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

    toast(orderId ? 'Pedido actualizado' : 'Pedido creado');
    closeModal();
    if (onSavedFn) onSavedFn();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
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
