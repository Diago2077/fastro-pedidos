import { db } from '../supabase.js';
import { toast, setLoading, esc } from '../utils/helpers.js';

export async function renderSettings(container) {
  container.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i></div>`;

  const { data, error } = await db.from('app_config').select('*');
  if (error) { toast('Error al cargar configuración', 'error'); return; }

  const cfg = Object.fromEntries((data || []).map(r => [r.key, r.value]));

  container.innerHTML = `
    <div class="card" style="max-width:600px">
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
    </div>`;

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
}
