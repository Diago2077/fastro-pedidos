import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, debounce, esc } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';

const COLS = [
  { key: 'name',       header: 'Nombre',   width: 20 },
  { key: 'store_name', header: 'Tienda',   width: 20 },
  { key: 'ruc',        header: 'RUC',      width: 15 },
  { key: 'phone',      header: 'Teléfono', width: 14 },
  { key: 'city',       header: 'Ciudad',   width: 14 },
  { key: 'email',      header: 'Correo',   width: 22 }
];

let _all = [];

export async function renderClients(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-actions">
          <div class="search-box">
            <i class="fas fa-search"></i>
            <input type="text" id="q-clients" placeholder="Buscar cliente…" class="form-control">
          </div>
          <button class="btn btn-sm btn-outline" onclick="window._cl.pdf()"><i class="fas fa-file-pdf"></i> PDF</button>
          <button class="btn btn-sm btn-outline" onclick="window._cl.xls()"><i class="fas fa-file-excel"></i> Excel</button>
          <button class="btn btn-accent" onclick="window._cl.form()"><i class="fas fa-plus"></i> Nuevo</button>
        </div>
      </div>
      <div class="table-responsive" id="cl-tbl"></div>
    </div>`;

  async function load(q = '') {
    let query = db.from('clients').select('*').eq('active', true).order('name');
    if (q) query = query.ilike('name', `%${q}%`);
    const { data, error } = await query;
    if (error) { toast('Error al cargar clientes', 'error'); return; }
    _all = data || [];
    render(_all);
  }

  function render(rows) {
    const el = document.getElementById('cl-tbl');
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState('No hay clientes registrados'); return; }
    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>Nombre</th><th>Tienda</th><th>RUC</th><th>Teléfono</th><th>Ciudad</th><th>Correo</th><th></th></tr></thead>
      <tbody>
        ${rows.map(c => `<tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.store_name || '–')}</td>
          <td>${esc(c.ruc || '–')}</td>
          <td>${esc(c.phone || '–')}</td>
          <td>${esc(c.city || '–')}</td>
          <td>${esc(c.email || '–')}</td>
          <td class="td-actions">
            <button class="btn btn-xs btn-outline" onclick="window._cl.form('${c.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn btn-xs btn-danger-outline" onclick="window._cl.del('${c.id}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function formHTML(c = {}) {
    return `<form id="cl-form" class="form-grid-2">
      <div class="form-group">
        <label class="form-label req">Nombre</label>
        <input type="text" name="name" class="form-control" value="${esc(c.name || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label">Nombre de Tienda</label>
        <input type="text" name="store_name" class="form-control" value="${esc(c.store_name || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">RUC</label>
        <input type="text" name="ruc" class="form-control" value="${esc(c.ruc || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Teléfono</label>
        <input type="text" name="phone" class="form-control" value="${esc(c.phone || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Ciudad</label>
        <input type="text" name="city" class="form-control" value="${esc(c.city || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Correo Electrónico</label>
        <input type="email" name="email" class="form-control" value="${esc(c.email || '')}">
      </div>
      <div class="form-footer span-2">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar</button>
      </div>
    </form>`;
  }

  window._cl = {
    async form(id) {
      let c = {};
      if (id) { const { data } = await db.from('clients').select('*').eq('id', id).single(); c = data || {}; }
      openModal(id ? 'Editar Cliente' : 'Nuevo Cliente', formHTML(c));
      document.getElementById('cl-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        setLoading(btn, true);
        const p = Object.fromEntries(new FormData(e.target));
        const { error } = id
          ? await db.from('clients').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id)
          : await db.from('clients').insert(p);
        setLoading(btn, false);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast(id ? 'Cliente actualizado' : 'Cliente creado');
        closeModal(); load();
      });
    },
    async del(id) {
      if (!await confirm2('¿Eliminar este cliente?')) return;
      await db.from('clients').update({ active: false }).eq('id', id);
      toast('Cliente eliminado'); load();
    },
    pdf() { exportPDF('Clientes', COLS, _all, 'clientes.pdf'); },
    xls() { exportExcel('Clientes', COLS, _all, 'clientes.xlsx'); }
  };

  document.getElementById('q-clients')?.addEventListener('input', debounce(e => load(e.target.value.trim()), 300));
  load();
}
