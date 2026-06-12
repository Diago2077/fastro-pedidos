import { db } from '../supabase.js';
import { toast, setLoading, esc } from '../utils/helpers.js';
import { setSizeOrderCache } from '../utils/sizes.js';

export async function renderSettings(container) {
  container.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i></div>`;

  const [{ data: cfgData, error }, { data: varData }] = await Promise.all([
    db.from('app_config').select('*'),
    db.from('product_variants').select('size')
  ]);
  if (error) { toast('Error al cargar configuración', 'error'); return; }

  const cfg = Object.fromEntries((cfgData || []).map(r => [r.key, r.value]));

  // Orden de tallas: el guardado primero (solo los que aún existen), luego las tallas nuevas
  const savedOrder = parseOrder(cfg.size_order);
  const allSizes = [...new Set((varData || []).map(v => String(v.size || '').trim()).filter(Boolean))];
  let order = [
    ...savedOrder.filter(s => allSizes.includes(s)),
    ...allSizes.filter(s => !savedOrder.includes(s))
  ];

  container.innerHTML = `
    <div class="settings-grid">
      <div class="card">
        <div class="card-header"><h5 class="card-title"><i class="fas fa-sliders-h"></i> Configuración General</h5></div>
        <div class="card-body">
          <form id="cfg-form">
            <div class="form-group">
              <label class="form-label">Nombre de la Empresa</label>
              <input type="text" name="company_name" class="form-control" value="${esc(cfg.company_name || 'FASTRO S.A.')}">
            </div>
            <div class="form-group">
              <label class="form-label req">Temporada Actual</label>
              <input type="text" name="current_season" class="form-control" value="${esc(cfg.current_season || '')}" required
                placeholder="Ej: Verano 2026">
              <small class="form-hint">Se usará como valor por defecto en nuevos productos y pedidos.</small>
            </div>
            <div class="form-footer">
              <button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar Configuración</button>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h5 class="card-title"><i class="fas fa-sort"></i> Orden de Tallas</h5></div>
        <div class="card-body">
          <p class="form-hint" style="margin-bottom:12px">
            Definí la prioridad de las tallas con las flechas. Este orden se aplica en el pedido,
            la edición de producto y la tabla de productos.
          </p>
          <div id="size-order-list" class="size-order-list"></div>
          <div class="form-footer">
            <button type="button" class="btn btn-accent" id="btn-save-size-order"><i class="fas fa-save"></i> Guardar Orden</button>
          </div>
        </div>
      </div>
    </div>`;

  // ---- Configuración general ----
  document.getElementById('cfg-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setLoading(btn, true);
    const fd = new FormData(e.target);
    const now = new Date().toISOString();

    const upserts = [...fd.entries()].map(([key, value]) => ({ key, value, updated_at: now }));
    const { error } = await db.from('app_config').upsert(upserts, { onConflict: 'key' });

    setLoading(btn, false);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    toast('Configuración guardada');
  });

  // ---- Orden de tallas ----
  const listEl = document.getElementById('size-order-list');

  function renderList() {
    if (!order.length) {
      listEl.innerHTML = `<p class="text-muted" style="padding:8px 0">No hay tallas registradas todavía.</p>`;
      return;
    }
    listEl.innerHTML = order.map((size, i) => `
      <div class="size-order-row">
        <span class="size-order-pos">${i + 1}</span>
        <span class="size-order-name">${esc(size)}</span>
        <span class="size-order-actions">
          <button type="button" class="btn btn-xs btn-outline so-up"   data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Subir"><i class="fas fa-arrow-up"></i></button>
          <button type="button" class="btn btn-xs btn-outline so-down" data-i="${i}" ${i === order.length - 1 ? 'disabled' : ''} title="Bajar"><i class="fas fa-arrow-down"></i></button>
        </span>
      </div>`).join('');
  }

  listEl?.addEventListener('click', e => {
    const up = e.target.closest('.so-up');
    const down = e.target.closest('.so-down');
    if (!up && !down) return;
    const i = parseInt((up || down).dataset.i, 10);
    const j = up ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    renderList();
  });

  document.getElementById('btn-save-size-order')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-size-order');
    setLoading(btn, true);
    const { error } = await db.from('app_config').upsert(
      { key: 'size_order', value: JSON.stringify(order), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    setLoading(btn, false);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    setSizeOrderCache(order);   // aplicar sin recargar
    toast('Orden de tallas guardado');
  });

  renderList();
}

function parseOrder(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.map(s => String(s)) : [];
  } catch (e) {
    return [];
  }
}
