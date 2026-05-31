import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, debounce, esc, fCurrency } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';
import { canSeeCost, canCreateProducts, canEditProducts, canDeleteProducts, canExportExcel } from '../auth.js';

let _all = [];

export async function renderProducts(container) {
  const _canCreate = canCreateProducts();
  const _canEdit   = canEditProducts();
  const _canDelete = canDeleteProducts();
  const _canCost   = canSeeCost();
  const _canXls    = canExportExcel();

  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-actions">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input type="text" id="q-prod" placeholder="Buscar por código o descripción…" class="form-control">
          </div>
          <button class="btn btn-sm btn-outline" title="Exportar PDF" onclick="window._pr.pdf()"><i class="fas fa-file-pdf"></i></button>
          ${_canXls    ? `<button class="btn btn-sm btn-outline" title="Exportar Excel" onclick="window._pr.xls()"><i class="fas fa-file-excel"></i></button>` : ''}
          ${_canCreate ? `<button class="btn btn-sm btn-outline" onclick="window._pr.importExcel()"><i class="fas fa-file-upload"></i> Importar Excel</button>` : ''}
          ${_canCreate ? `<button class="btn btn-accent" onclick="window._pr.form()"><i class="fas fa-plus"></i> Nuevo Producto</button>` : ''}
        </div>
      </div>
      <div class="table-responsive" id="pr-tbl"></div>
    </div>`;

  async function load(q = '') {
    let query = db.from('products').select('*, providers(name), product_variants(id, color, size, sale_price, cost_price)').eq('active', true).order('code');
    if (q) query = query.or(`code.ilike.%${q}%,description.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) { toast('Error al cargar productos', 'error'); return; }
    _all = data || [];
    render(_all);
  }

  function render(rows) {
    const el = document.getElementById('pr-tbl');
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState('No hay productos registrados'); return; }
    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>Código</th><th>Descripción</th><th>Marca</th><th>Proveedor</th><th>Temporada</th><th>Colores</th><th>Tallas</th><th class="text-end">Precio Venta</th><th></th></tr></thead>
      <tbody>
        ${rows.map(p => {
          const variants = p.product_variants || [];
          const colors = [...new Set(variants.map(v => v.color))].join(', ') || '–';

          // Agrupar tallas por precio: una fila por cada precio distinto
          const byPrice = new Map();
          variants.forEach(v => {
            const key = v.sale_price ?? 0;
            if (!byPrice.has(key)) byPrice.set(key, new Set());
            byPrice.get(key).add(v.size);
          });
          const groups = [...byPrice.entries()].sort((a, b) => a[0] - b[0]);

          const actions = `<td class="td-actions">
              ${_canEdit   ? `<button class="btn btn-xs btn-outline" onclick="window._pr.form('${p.id}')"><i class="fas fa-edit"></i></button>` : ''}
              ${_canDelete ? `<button class="btn btn-xs btn-danger-outline" onclick="window._pr.del('${p.id}')"><i class="fas fa-trash"></i></button>` : ''}
            </td>`;

          const makeRow = (sizes, priceLabel) => `<tr>
            <td><strong>${esc(p.code)}</strong></td>
            <td>${esc(p.description)}</td>
            <td>${esc(p.brand || '–')}</td>
            <td>${esc(p.providers?.name || '–')}</td>
            <td>${esc(p.season || '–')}</td>
            <td><span class="text-muted small">${esc(colors)}</span></td>
            <td><span class="text-muted small">${esc(sizes)}</span></td>
            <td class="text-end">${priceLabel}</td>
            ${actions}
          </tr>`;

          // Sin variantes => una sola fila con guiones
          if (!groups.length) return makeRow('–', '–');
          // Una fila por precio, con solo las tallas de ese precio
          return groups.map(([price, sizeSet]) => makeRow([...sizeSet].join(', '), fCurrency(price))).join('');
        }).join('')}
      </tbody>
    </table>`;
  }

  window._pr = {
    async form(id) {
      // Load providers for dropdown
      const { data: provs } = await db.from('providers').select('id, name').eq('active', true).order('name');
      const { data: cfg } = await db.from('app_config').select('value').eq('key', 'current_season').single();

      let p = { season: cfg?.value || '' };
      let variants = []; // existing variants
      if (id) {
        const { data } = await db.from('products').select('*, product_variants(*)').eq('id', id).single();
        p = data || p;
        variants = data?.product_variants || [];
      }

      // Build size/price map and color list from existing variants
      const sizePriceMap = {}; // size -> { sale_price, cost_price }
      const colorsSet = new Set();
      variants.forEach(v => {
        colorsSet.add(v.color);
        if (!sizePriceMap[v.size]) sizePriceMap[v.size] = { sale_price: v.sale_price, cost_price: v.cost_price };
      });
      const initSizes = Object.entries(sizePriceMap).map(([size, prices]) => ({ size, ...prices }));
      const initColors = [...colorsSet];

      const html = buildProductFormHTML(p, provs || [], initSizes, initColors);
      openModal(id ? 'Editar Producto' : 'Nuevo Producto', html, { size: 'lg' });
      initProductForm(id, p, load);
    },

    async del(id) {
      if (!await confirm2('¿Eliminar este producto y todas sus variantes?')) return;
      await db.from('products').update({ active: false }).eq('id', id);
      toast('Producto eliminado'); load();
    },

    pdf() {
      const cols = [
        { key: 'code', header: 'Código' }, { key: 'description', header: 'Descripción' },
        { key: 'brand', header: 'Marca' }, { key: 'season', header: 'Temporada' }
      ];
      exportPDF('Productos', cols, _all, 'productos.pdf');
    },
    xls() {
      const cols = [
        { key: 'code', header: 'Código' }, { key: 'description', header: 'Descripción' },
        { key: 'brand', header: 'Marca' }, { key: 'season', header: 'Temporada' }
      ];
      exportExcel('Productos', cols, _all, 'productos.xlsx');
    },
    importExcel() { openImportModal(load); },
    downloadTemplate
  };

  document.getElementById('q-prod')?.addEventListener('input', debounce(e => load(e.target.value.trim()), 300));
  load();
}

function buildProductFormHTML(p, provs, initSizes, initColors) {
  const showCost = canSeeCost();
  const opts = provs.map(pv => `<option value="${pv.id}" ${p.provider_id === pv.id ? 'selected' : ''}>${esc(pv.name)}</option>`).join('');
  return `
  <form id="pr-form">
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label req">Código</label>
        <input type="text" name="code" class="form-control" value="${esc(p.code || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label req">Descripción</label>
        <input type="text" name="description" class="form-control" value="${esc(p.description || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label">Marca</label>
        <input type="text" name="brand" class="form-control" value="${esc(p.brand || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Proveedor</label>
        <select name="provider_id" class="form-control">
          <option value="">— Sin proveedor —</option>
          ${opts}
        </select>
      </div>
      <div class="form-group span-2">
        <label class="form-label">Temporada</label>
        <input type="text" name="season" class="form-control" value="${esc(p.season || '')}">
      </div>
    </div>

    <!-- TALLAS Y PRECIOS -->
    <div class="variant-section">
      <div class="variant-section-header">
        <h6><i class="fas fa-ruler"></i> Tallas y Precios</h6>
        <button type="button" class="btn btn-sm btn-outline" id="btn-add-size"><i class="fas fa-plus"></i> Agregar Talla</button>
      </div>
      <div class="sizes-table-wrap">
        <table class="table table-sm" id="sizes-table">
          <thead><tr><th>Talla</th><th>Precio Venta</th>${showCost ? '<th>Precio Costo</th>' : ''}<th></th></tr></thead>
          <tbody id="sizes-tbody">
            ${initSizes.map((s, i) => sizeRowHTML(i, s.size, s.sale_price, s.cost_price, showCost)).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- COLORES -->
    <div class="variant-section">
      <div class="variant-section-header">
        <h6><i class="fas fa-palette"></i> Colores</h6>
        <button type="button" class="btn btn-sm btn-outline" id="btn-add-color"><i class="fas fa-plus"></i> Agregar Color</button>
      </div>
      <div class="colors-list" id="colors-list">
        ${initColors.map((c, i) => colorTagHTML(i, c)).join('')}
      </div>
    </div>

    <!-- RESUMEN VARIANTES -->
    <div class="variant-preview" id="variant-preview"></div>

    <div class="form-footer">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar Producto</button>
    </div>
  </form>`;
}

function sizeRowHTML(idx, size = '', sale = '', cost = '', showCost = true) {
  return `<tr data-size-idx="${idx}">
    <td><input type="text" class="form-control form-control-sm sz-name" placeholder="Ej: M" value="${esc(size)}" required></td>
    <td><input type="number" step="0.01" min="0" class="form-control form-control-sm sz-sale" placeholder="0.00" value="${sale}"></td>
    ${showCost ? `<td><input type="number" step="0.01" min="0" class="form-control form-control-sm sz-cost" placeholder="0.00" value="${cost}"></td>` : `<td style="display:none"><input type="hidden" class="sz-cost" value="${cost}"></td>`}
    <td><button type="button" class="btn btn-xs btn-danger-outline btn-rm-size"><i class="fas fa-times"></i></button></td>
  </tr>`;
}

function colorTagHTML(idx, color = '') {
  return `<div class="color-tag" data-color-idx="${idx}">
    <input type="text" class="form-control form-control-sm color-name" placeholder="Ej: Rojo" value="${esc(color)}" required>
    <button type="button" class="btn btn-xs btn-danger-outline btn-rm-color"><i class="fas fa-times"></i></button>
  </div>`;
}

function updateVariantPreview() {
  const preview = document.getElementById('variant-preview');
  if (!preview) return;
  const sizes = [...document.querySelectorAll('#sizes-tbody tr')].map(r => r.querySelector('.sz-name')?.value.trim()).filter(Boolean);
  const colors = [...document.querySelectorAll('#colors-list .color-name')].map(i => i.value.trim()).filter(Boolean);
  if (!sizes.length || !colors.length) { preview.innerHTML = ''; return; }
  const total = sizes.length * colors.length;
  preview.innerHTML = `<div class="variant-count"><i class="fas fa-info-circle"></i> <strong>${total} variantes</strong> generadas (${colors.length} colores × ${sizes.length} tallas)</div>`;
}

function initProductForm(id, originalProduct, reloadFn) {
  let sizeIdx = document.querySelectorAll('#sizes-tbody tr').length;
  let colorIdx = document.querySelectorAll('#colors-list .color-tag').length;

  document.getElementById('btn-add-size')?.addEventListener('click', () => {
    document.getElementById('sizes-tbody').insertAdjacentHTML('beforeend', sizeRowHTML(sizeIdx++, '', '', '', canSeeCost()));
    updateVariantPreview();
  });

  document.getElementById('btn-add-color')?.addEventListener('click', () => {
    document.getElementById('colors-list').insertAdjacentHTML('beforeend', colorTagHTML(colorIdx++));
    updateVariantPreview();
  });

  document.getElementById('sizes-table')?.addEventListener('click', e => {
    if (e.target.closest('.btn-rm-size')) { e.target.closest('tr').remove(); updateVariantPreview(); }
  });

  document.getElementById('colors-list')?.addEventListener('click', e => {
    if (e.target.closest('.btn-rm-color')) { e.target.closest('.color-tag').remove(); updateVariantPreview(); }
  });

  // Live preview on input changes
  document.getElementById('pr-form')?.addEventListener('input', updateVariantPreview);
  updateVariantPreview();

  document.getElementById('pr-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setLoading(btn, true);

    const fd = new FormData(e.target);
    const payload = {
      code:        fd.get('code').trim(),
      description: fd.get('description').trim(),
      brand:       fd.get('brand').trim() || null,
      provider_id: fd.get('provider_id') || null,
      season:      fd.get('season').trim() || null,
      updated_at:  new Date().toISOString()
    };

    // Collect sizes with prices
    const sizes = [...document.querySelectorAll('#sizes-tbody tr')].map(r => ({
      size:       r.querySelector('.sz-name').value.trim(),
      sale_price: parseFloat(r.querySelector('.sz-sale').value) || 0,
      cost_price: parseFloat(r.querySelector('.sz-cost').value) || 0
    })).filter(s => s.size);

    const colors = [...document.querySelectorAll('#colors-list .color-name')]
      .map(i => i.value.trim()).filter(Boolean);

    if (!sizes.length || !colors.length) {
      toast('Agrega al menos una talla y un color', 'warning');
      setLoading(btn, false);
      return;
    }

    try {
      let productId = id;

      if (id) {
        const { error } = await db.from('products').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await db.from('products').insert({ ...payload, active: true }).select('id').single();
        if (error) throw error;
        productId = data.id;
      }

      // Build all variant combinations
      const variantPayloads = [];
      for (const color of colors) {
        for (const s of sizes) {
          variantPayloads.push({
            product_id: productId,
            color,
            size:       s.size,
            sale_price: s.sale_price,
            cost_price: s.cost_price
          });
        }
      }

      // Upsert variants (insert or update on conflict)
      const { error: vErr } = await db.from('product_variants').upsert(variantPayloads, {
        onConflict: 'product_id,color,size',
        ignoreDuplicates: false
      });
      if (vErr) throw vErr;

      // Remove variants not in current selection
      const currentKeys = new Set(variantPayloads.map(v => `${v.color}|||${v.size}`));
      const { data: existingVars } = await db.from('product_variants').select('id, color, size').eq('product_id', productId);
      const toDelete = (existingVars || []).filter(v => !currentKeys.has(`${v.color}|||${v.size}`));
      if (toDelete.length) {
        await db.from('product_variants').delete().in('id', toDelete.map(v => v.id));
      }

      toast(id ? 'Producto actualizado' : 'Producto creado');
      closeModal();
      reloadFn();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

// ============================================================
// IMPORTACIÓN DESDE EXCEL
// ============================================================

// Normaliza el nombre de columna para hacer el mapeo flexible
function normalizeHeader(h) {
  return String(h).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/[^a-z0-9]/g, '');                        // solo alfanumérico
}

const HEADER_MAP = {
  codigo:       'code',
  code:         'code',
  cod:          'code',
  descripcion:  'description',
  description:  'description',
  desc:         'description',
  marca:        'brand',
  brand:        'brand',
  proveedor:    'provider_name',
  provider:     'provider_name',
  temporada:    'season',
  season:       'season',
  color:        'color',
  talla:        'size',
  size:         'size',
  talle:        'size',
  precioventa:  'sale_price',
  pventa:       'sale_price',
  saleprice:    'sale_price',
  pvp:          'sale_price',
  precio_venta: 'sale_price',
  preciov:      'sale_price',
  preciocosto:  'cost_price',
  pcosto:       'cost_price',
  costprice:    'cost_price',
  costo:        'cost_price',
  precio_costo: 'cost_price',
  precioc:      'cost_price',
};

function parseSheetRows(sheet) {
  const raw = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (raw.length < 2) return { rows: [], errors: ['El archivo no tiene datos'] };

  // Map headers
  const headers = raw[0].map(h => HEADER_MAP[normalizeHeader(h)] || null);
  const missing = ['code', 'description', 'color', 'size', 'sale_price']
    .filter(f => !headers.includes(f));
  if (missing.length) return { rows: [], errors: [`Columnas faltantes: ${missing.join(', ')}`] };

  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const rowRaw = raw[i];
    if (rowRaw.every(c => !c)) continue; // skip empty rows
    const row = {};
    headers.forEach((field, idx) => { if (field) row[field] = rowRaw[idx]; });
    if (!row.code || !row.description || !row.color || !row.size || !row.sale_price) continue;
    row.sale_price = parseFloat(String(row.sale_price).replace(',', '.')) || 0;
    row.cost_price = parseFloat(String(row.cost_price || '0').replace(',', '.')) || 0;
    row.code        = String(row.code).trim().toUpperCase();
    row.description = String(row.description).trim();
    row.color       = String(row.color).trim();
    row.size        = String(row.size).trim();
    row.brand       = row.brand ? String(row.brand).trim() : '';
    row.provider_name = row.provider_name ? String(row.provider_name).trim() : '';
    row.season      = row.season ? String(row.season).trim() : '';
    rows.push(row);
  }
  return { rows, errors: [] };
}

export function openImportModal(reloadFn) {
  const html = `
    <div class="import-wrap">
      <!-- Instrucciones -->
      <div class="import-info">
        <p class="mb-2"><strong>Formato requerido:</strong> una fila por cada variante (Color + Talla).</p>
        <table class="table table-sm table-bordered" style="font-size:.82em">
          <thead><tr><th>Columna</th><th>Descripción</th><th>Req.</th></tr></thead>
          <tbody>
            <tr><td><code>Codigo</code></td><td>Código único del producto</td><td>✓</td></tr>
            <tr><td><code>Descripcion</code></td><td>Nombre del producto</td><td>✓</td></tr>
            <tr><td><code>Marca</code></td><td>Marca (texto libre)</td><td></td></tr>
            <tr><td><code>Proveedor</code></td><td>Nombre del proveedor</td><td></td></tr>
            <tr><td><code>Temporada</code></td><td>Temporada</td><td></td></tr>
            <tr><td><code>Color</code></td><td>Color de la variante</td><td>✓</td></tr>
            <tr><td><code>Talla</code></td><td>Talla de la variante</td><td>✓</td></tr>
            <tr><td><code>PrecioVenta</code></td><td>Precio de venta (número)</td><td>✓</td></tr>
            <tr><td><code>PrecioCosto</code></td><td>Precio de costo (número)</td><td></td></tr>
          </tbody>
        </table>
        <button class="btn btn-sm btn-outline" onclick="window._pr.downloadTemplate()">
          <i class="fas fa-download"></i> Descargar plantilla de ejemplo
        </button>
      </div>

      <!-- Dropzone -->
      <div class="dropzone" id="import-dropzone">
        <i class="fas fa-file-excel" style="font-size:2.5em;color:#38a169;margin-bottom:10px"></i>
        <p style="margin-bottom:10px;color:var(--text-muted)">Arrastra tu archivo aquí o</p>
        <label class="btn btn-outline" style="cursor:pointer">
          <i class="fas fa-folder-open"></i> Seleccionar archivo (.xlsx / .xls / .csv)
          <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" hidden>
        </label>
        <p id="import-filename" style="margin-top:8px;font-size:.8em;color:var(--text-muted)"></p>
      </div>

      <!-- Preview -->
      <div id="import-preview" class="hidden">
        <div id="import-summary" class="import-summary"></div>
        <div class="table-responsive mt-2" id="import-preview-table" style="max-height:280px;overflow-y:auto"></div>
        <div class="form-footer">
          <button type="button" class="btn btn-secondary" onclick="document.getElementById('import-preview').classList.add('hidden');document.getElementById('import-dropzone').classList.remove('hidden');">
            <i class="fas fa-arrow-left"></i> Cambiar archivo
          </button>
          <button type="button" class="btn btn-accent" id="btn-confirm-import">
            <i class="fas fa-upload"></i> Confirmar Importación
          </button>
        </div>
      </div>
    </div>`;

  openModal('Importar Productos desde Excel', html, { size: 'lg' });

  // File input
  const fileInput = document.getElementById('import-file-input');
  const dropzone  = document.getElementById('import-dropzone');

  fileInput?.addEventListener('change', e => handleFile(e.target.files[0]));

  // Drag & drop
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });

  let _parsedRows = [];

  function handleFile(file) {
    if (!file) return;
    document.getElementById('import-filename').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      const wb = window.XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const { rows, errors } = parseSheetRows(sheet);

      if (errors.length) {
        toast(errors[0], 'error');
        return;
      }

      _parsedRows = rows;
      showPreview(rows);
    };
    reader.readAsArrayBuffer(file);
  }

  function showPreview(rows) {
    const uniqueProducts = [...new Set(rows.map(r => r.code))].length;
    const summary = document.getElementById('import-summary');
    summary.innerHTML = `
      <div class="import-summary-box">
        <span><i class="fas fa-boxes"></i> <strong>${uniqueProducts}</strong> productos</span>
        <span><i class="fas fa-layer-group"></i> <strong>${rows.length}</strong> variantes</span>
        <span><i class="fas fa-palette"></i> <strong>${[...new Set(rows.map(r => r.color))].length}</strong> colores distintos</span>
      </div>`;

    const previewTable = document.getElementById('import-preview-table');
    previewTable.innerHTML = `
      <table class="table table-sm table-bordered">
        <thead><tr><th>Código</th><th>Descripción</th><th>Marca</th><th>Proveedor</th><th>Temporada</th><th>Color</th><th>Talla</th><th>P.Venta</th><th>P.Costo</th></tr></thead>
        <tbody>
          ${rows.slice(0, 50).map(r => `<tr>
            <td>${esc(r.code)}</td><td>${esc(r.description)}</td><td>${esc(r.brand)}</td>
            <td>${esc(r.provider_name)}</td><td>${esc(r.season)}</td><td>${esc(r.color)}</td>
            <td>${esc(r.size)}</td><td>$${r.sale_price.toFixed(2)}</td><td>$${r.cost_price.toFixed(2)}</td>
          </tr>`).join('')}
          ${rows.length > 50 ? `<tr><td colspan="9" class="text-center text-muted">… y ${rows.length - 50} filas más</td></tr>` : ''}
        </tbody>
      </table>`;

    dropzone.classList.add('hidden');
    document.getElementById('import-preview').classList.remove('hidden');
  }

  document.getElementById('btn-confirm-import')?.addEventListener('click', async () => {
    if (!_parsedRows.length) return;
    const btn = document.getElementById('btn-confirm-import');
    setLoading(btn, true);
    try {
      const result = await executeImport(_parsedRows);
      toast(`Importación completa: ${result.created} nuevos, ${result.updated} actualizados${result.errors > 0 ? `, ${result.errors} con errores` : ''}`, result.errors > 0 ? 'warning' : 'success', 5000);
      closeModal();
      reloadFn();
    } catch (err) {
      toast('Error durante importación: ' + err.message, 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function executeImport(rows) {
  let created = 0, updated = 0, errors = 0;

  // 1. Resolve/create providers in batch
  const providerNames = [...new Set(rows.map(r => r.provider_name).filter(Boolean))];
  const providerMap = {};
  if (providerNames.length) {
    const { data: existingProvs } = await db.from('providers').select('id, name').in('name', providerNames);
    existingProvs?.forEach(p => { providerMap[p.name] = p.id; });
    for (const name of providerNames) {
      if (!providerMap[name]) {
        const { data } = await db.from('providers').insert({ name }).select('id').single();
        if (data) providerMap[name] = data.id;
      }
    }
  }

  // 2. Group rows by product code
  const groups = {};
  rows.forEach(r => {
    if (!groups[r.code]) groups[r.code] = { info: r, variants: [] };
    groups[r.code].variants.push({ color: r.color, size: r.size, sale_price: r.sale_price, cost_price: r.cost_price });
  });

  // 3. Check which codes already exist
  const codes = Object.keys(groups);
  const { data: existing } = await db.from('products').select('id, code').in('code', codes);
  const existingMap = Object.fromEntries((existing || []).map(p => [p.code, p.id]));

  // 4. Process each product
  for (const [code, { info, variants }] of Object.entries(groups)) {
    try {
      const payload = {
        code,
        description: info.description,
        brand:       info.brand || null,
        provider_id: info.provider_name ? (providerMap[info.provider_name] || null) : null,
        season:      info.season || null,
        active:      true,
        updated_at:  new Date().toISOString()
      };

      let productId = existingMap[code];

      if (productId) {
        await db.from('products').update(payload).eq('id', productId);
        updated++;
      } else {
        const { data, error } = await db.from('products').insert(payload).select('id').single();
        if (error) throw error;
        productId = data.id;
        created++;
      }

      // Upsert variants
      const variantPayloads = variants.map(v => ({ product_id: productId, ...v }));
      await db.from('product_variants').upsert(variantPayloads, { onConflict: 'product_id,color,size', ignoreDuplicates: false });
    } catch {
      errors++;
    }
  }

  return { created, updated, errors };
}

export function downloadTemplate() {
  const data = [
    ['Codigo', 'Descripcion', 'Marca', 'Proveedor', 'Temporada', 'Color', 'Talla', 'PrecioVenta', 'PrecioCosto'],
    ['CAM001', 'Camiseta Básica', 'Nike', 'Textilera ABC', 'Verano 2026', 'Rojo',  'S',  10.00, 6.00],
    ['CAM001', 'Camiseta Básica', 'Nike', 'Textilera ABC', 'Verano 2026', 'Rojo',  'M',  11.00, 6.00],
    ['CAM001', 'Camiseta Básica', 'Nike', 'Textilera ABC', 'Verano 2026', 'Rojo',  'L',  12.00, 6.50],
    ['CAM001', 'Camiseta Básica', 'Nike', 'Textilera ABC', 'Verano 2026', 'Azul',  'S',  10.00, 6.00],
    ['CAM001', 'Camiseta Básica', 'Nike', 'Textilera ABC', 'Verano 2026', 'Azul',  'M',  11.00, 6.00],
    ['PAN002', 'Pantalón Sport',  'Adidas', 'Textilera ABC', 'Verano 2026', 'Negro', '28', 25.00, 15.00],
    ['PAN002', 'Pantalón Sport',  'Adidas', 'Textilera ABC', 'Verano 2026', 'Negro', '30', 25.00, 15.00],
    ['PAN002', 'Pantalón Sport',  'Adidas', 'Textilera ABC', 'Verano 2026', 'Gris',  '28', 25.00, 15.00],
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [14,20,12,16,14,10,8,12,12].map(w => ({ wch: w }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  window.XLSX.writeFile(wb, 'plantilla-productos.xlsx');
}
