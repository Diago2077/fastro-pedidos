import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, debounce, esc } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';
import { canExportExcel, canCreateProviders, canEditProviders, canDeleteProviders } from '../auth.js';

let _all = [];

export async function renderProviders(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-actions">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input type="text" id="q-prov" placeholder="Buscar proveedor…" class="form-control">
          </div>
          <button class="btn btn-sm btn-outline" title="Exportar PDF" onclick="window._pv.pdf()"><i class="fas fa-file-pdf"></i></button>
          ${canExportExcel() ? `<button class="btn btn-sm btn-outline" title="Exportar Excel" onclick="window._pv.xls()"><i class="fas fa-file-excel"></i></button>` : ''}
          ${canCreateProviders() ? `<button class="btn btn-accent" onclick="window._pv.form()"><i class="fas fa-plus"></i> Nuevo</button>` : ''}
        </div>
      </div>
      <div class="table-responsive" id="pv-tbl"></div>
    </div>`;

  async function load(q = '') {
    let query = db.from('providers').select('*').eq('active', true).order('name');
    if (q) query = query.ilike('name', `%${q}%`);
    const { data, error } = await query;
    if (error) { toast('Error al cargar proveedores', 'error'); return; }
    _all = data || [];
    render(_all);
  }

  function render(rows) {
    const el = document.getElementById('pv-tbl');
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState('No hay proveedores registrados'); return; }
    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>Nombre</th><th>Fecha de registro</th><th></th></tr></thead>
      <tbody>
        ${rows.map(p => `<tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${new Date(p.created_at).toLocaleDateString('es-EC')}</td>
          <td class="td-actions">
            ${canEditProviders()   ? `<button class="btn btn-xs btn-outline" onclick="window._pv.form('${p.id}')"><i class="fas fa-edit"></i></button>` : ''}
            ${canDeleteProviders() ? `<button class="btn btn-xs btn-danger-outline" onclick="window._pv.del('${p.id}')"><i class="fas fa-trash"></i></button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function formHTML(p = {}) {
    return `<form id="pv-form">
      <div class="form-group">
        <label class="form-label req">Nombre del Proveedor</label>
        <input type="text" name="name" class="form-control" value="${esc(p.name || '')}" required autofocus>
      </div>
      <div class="form-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar</button>
      </div>
    </form>`;
  }

  window._pv = {
    async form(id) {
      let p = {};
      if (id) { const { data } = await db.from('providers').select('*').eq('id', id).single(); p = data || {}; }
      openModal(id ? 'Editar Proveedor' : 'Nuevo Proveedor', formHTML(p), { size: 'sm' });
      document.getElementById('pv-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        setLoading(btn, true);
        const name = new FormData(e.target).get('name');
        const { error } = id
          ? await db.from('providers').update({ name, updated_at: new Date().toISOString() }).eq('id', id)
          : await db.from('providers').insert({ name });
        setLoading(btn, false);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast(id ? 'Proveedor actualizado' : 'Proveedor creado');
        closeModal(); load();
      });
    },
    async del(id) {
      if (!await confirm2('¿Eliminar este proveedor?')) return;
      await db.from('providers').update({ active: false }).eq('id', id);
      toast('Proveedor eliminado'); load();
    },
    pdf() { exportPDF('Proveedores', [{ key: 'name', header: 'Nombre' }], _all, 'proveedores.pdf'); },
    xls() { exportExcel('Proveedores', [{ key: 'name', header: 'Nombre' }], _all, 'proveedores.xlsx'); }
  };

  document.getElementById('q-prov')?.addEventListener('input', debounce(e => load(e.target.value.trim()), 300));
  load();
}
