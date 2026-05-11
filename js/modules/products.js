import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, debounce, esc } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';

let _all = [];

export async function renderProducts(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-actions">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input type="text" id="q-prod" placeholder="Buscar por código o descripción…" class="form-control">
          </div>
          <button class="btn btn-sm btn-outline" onclick="window._pr.pdf()"><i class="fas fa-file-pdf"></i> PDF</button>
          <button class="btn btn-sm btn-outline" onclick="window._pr.xls()"><i class="fas fa-file-excel"></i> Excel</button>
          <button class="btn btn-accent" onclick="window._pr.form()"><i class="fas fa-plus"></i> Nuevo Producto</button>
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
      <thead><tr><th>Código</th><th>Descripción</th><th>Marca</th><th>Proveedor</th><th>Temporada</th><th>Colores</th><th>Tallas</th><th></th></tr></thead>
      <tbody>
        ${rows.map(p => {
          const colors = [...new Set((p.product_variants || []).map(v => v.color))].join(', ');
          const sizes  = [...new Set((p.product_variants || []).map(v => v.size))].join(', ');
          return `<tr>
            <td><strong>${esc(p.code)}</strong></td>
            <td>${esc(p.description)}</td>
            <td>${esc(p.brand || '–')}</td>
            <td>${esc(p.providers?.name || '–')}</td>
            <td>${esc(p.season || '–')}</td>
            <td><span class="text-muted small">${esc(colors || '–')}</span></td>
            <td><span class="text-muted small">${esc(sizes || '–')}</span></td>
            <td class="td-actions">
              <button class="btn btn-xs btn-outline" onclick="window._pr.form('${p.id}')"><i class="fas fa-edit"></i></button>
              <button class="btn btn-xs btn-danger-outline" onclick="window._pr.del('${p.id}')"><i class="fas fa-trash"></i></button>
            </td>
          </tr>`;
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
    }
  };

  document.getElementById('q-prod')?.addEventListener('input', debounce(e => load(e.target.value.trim()), 300));
  load();
}

function buildProductFormHTML(p, provs, initSizes, initColors) {
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
          <thead><tr><th>Talla</th><th>Precio Venta</th><th>Precio Costo</th><th></th></tr></thead>
          <tbody id="sizes-tbody">
            ${initSizes.map((s, i) => sizeRowHTML(i, s.size, s.sale_price, s.cost_price)).join('')}
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

function sizeRowHTML(idx, size = '', sale = '', cost = '') {
  return `<tr data-size-idx="${idx}">
    <td><input type="text" class="form-control form-control-sm sz-name" placeholder="Ej: M" value="${esc(size)}" required></td>
    <td><input type="number" step="0.01" min="0" class="form-control form-control-sm sz-sale" placeholder="0.00" value="${sale}"></td>
    <td><input type="number" step="0.01" min="0" class="form-control form-control-sm sz-cost" placeholder="0.00" value="${cost}"></td>
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
    document.getElementById('sizes-tbody').insertAdjacentHTML('beforeend', sizeRowHTML(sizeIdx++));
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
