import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, loadingHTML, setLoading, esc, enableTableSort, enableColumnResize, lazyRenderRows, enableRowClick } from '../utils/helpers.js';
import { getSession } from '../auth.js';

export async function renderUsers(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="user-create-hint">
          <i class="fas fa-info-circle"></i>
          <span>Para <strong>crear</strong> un usuario nuevo, agregalo en Supabase → <em>Authentication → Add user</em> (con "Auto Confirm"). Aparecerá aquí automáticamente para asignarle rol y permisos.</span>
        </div>
      </div>
      <div class="table-responsive" id="usr-tbl"></div>
    </div>`;

  async function load() {
    const tbl = document.getElementById('usr-tbl');
    if (tbl) tbl.innerHTML = loadingHTML();
    const { data, error } = await db.from('profiles').select('id, name, email, role, active, created_at').order('name');
    if (error) { if (tbl) tbl.innerHTML = emptyState('Error al cargar usuarios'); toast('Error al cargar usuarios', 'error'); return; }
    render(data || []);
  }

  function render(rows) {
    const el = document.getElementById('usr-tbl');
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState('No hay usuarios'); return; }
    const currentId = getSession()?.id;
    const rowsHTML = rows.map(u => `<tr data-id="${u.id}">
      <td><strong>${esc(u.name || '—')}</strong>${u.id === currentId ? ' <span class="badge badge-info">Yo</span>' : ''}</td>
      <td>${esc(u.email)}</td>
      <td><span class="badge ${u.role === 'admin' ? 'badge-danger' : 'badge-secondary'}">${u.role === 'admin' ? 'Admin' : 'Usuario'}</span></td>
      <td><span class="badge ${u.active ? 'badge-success' : 'badge-secondary'}">${u.active ? 'Activo' : 'Inactivo'}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString('es-PY')}</td>
    </tr>`);

    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Creado</th></tr></thead>
      <tbody></tbody>
    </table>`;
    const table = el.querySelector('table');
    const lazy = lazyRenderRows(table, rowsHTML);
    enableTableSort(table, { onBeforeSort: lazy.renderAll });
    enableColumnResize(table);
    enableRowClick(table, id => window._usr.view(id));
  }

  function detailHTML(u, currentId) {
    const row = (label, val) =>
      `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${esc(val == null || val === '' ? '–' : String(val))}</span></div>`;
    return `<div class="client-detail">
      ${row('Nombre', u.name)}
      ${row('Correo', u.email)}
      ${row('Rol', u.role === 'admin' ? 'Admin' : 'Usuario')}
      ${row('Estado', u.active ? 'Activo' : 'Inactivo')}
      ${row('Creado', u.created_at ? new Date(u.created_at).toLocaleDateString('es-PY') : '')}
    </div>
    <div class="form-footer">
      ${u.id !== currentId ? `<button type="button" class="btn btn-danger-outline" style="margin-right:auto" title="${u.active ? 'Desactivar' : 'Activar'}" onclick="window._usr.toggle('${u.id}', ${u.active})"><i class="fas fa-${u.active ? 'ban' : 'check'}"></i></button>` : ''}
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cerrar</button>
      <button type="button" class="btn btn-accent" onclick="window._usr.form('${u.id}')"><i class="fas fa-edit"></i> Editar</button>
    </div>`;
  }

  function formHTML(u = {}) {
    const isUserRole = (u.role || 'user') !== 'admin';
    return `<form id="usr-form" class="form-grid-2">
      <div class="form-group">
        <label class="form-label req">Nombre</label>
        <input type="text" name="name" class="form-control" value="${esc(u.name || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label">Correo Electrónico</label>
        <input type="email" name="email" class="form-control" value="${esc(u.email || '')}" readonly>
      </div>
      <div class="form-group span-2">
        <label class="form-label">Rol</label>
        <select name="role" id="usr-role-select" class="form-control">
          <option value="user"  ${(u.role || 'user') === 'user'  ? 'selected' : ''}>Usuario</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
      </div>

      <!-- Permisos por módulo — solo visibles para rol Usuario -->
      <div class="form-group span-2" id="perms-section" ${isUserRole ? '' : 'style="display:none"'}>
        <label class="form-label">Permisos por módulo</label>
        <div class="perms-table">
          <div class="perms-head">
            <span>Módulo</span><span>Ver</span><span>Crear</span><span>Editar</span><span>Borrar</span>
          </div>
          <div class="perms-row">
            <span><i class="fas fa-tachometer-alt"></i> Dashboard</span>
            <span><input type="checkbox" name="can_view_dashboard" ${(u.can_view_dashboard ?? true) ? 'checked' : ''}></span>
            <span class="perm-na">—</span><span class="perm-na">—</span><span class="perm-na">—</span>
          </div>
          <div class="perms-row">
            <span><i class="fas fa-file-invoice"></i> Pedidos</span>
            <span><input type="checkbox" name="can_view_orders"   ${(u.can_view_orders   ?? true) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_create_orders" ${(u.can_create_orders ?? true) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_edit_orders"   ${(u.can_edit_orders   ?? true) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_delete_orders" ${(u.can_delete_orders ?? true) ? 'checked' : ''}></span>
          </div>
          <div class="perms-row">
            <span><i class="fas fa-users"></i> Clientes</span>
            <span><input type="checkbox" name="can_view_clients"   ${(u.can_view_clients   ?? false) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_create_clients" ${(u.can_create_clients ?? false) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_edit_clients"   ${(u.can_edit_clients   ?? false) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_delete_clients" ${(u.can_delete_clients ?? false) ? 'checked' : ''}></span>
          </div>
          <div class="perms-row">
            <span><i class="fas fa-box-open"></i> Productos</span>
            <span><input type="checkbox" name="can_view_products"    ${(u.can_view_products    ?? true)  ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_create_products"  ${(u.can_create_products  ?? false) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_edit_products"    ${(u.can_edit_products    ?? false) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_delete_products"  ${(u.can_delete_products  ?? false) ? 'checked' : ''}></span>
          </div>
          <div class="perms-row">
            <span><i class="fas fa-truck"></i> Proveedores</span>
            <span><input type="checkbox" name="can_view_providers"    ${(u.can_view_providers    ?? true) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_create_providers"  ${(u.can_create_providers  ?? true) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_edit_providers"    ${(u.can_edit_providers    ?? true) ? 'checked' : ''}></span>
            <span><input type="checkbox" name="can_delete_providers"  ${(u.can_delete_providers  ?? true) ? 'checked' : ''}></span>
          </div>
          <div class="perms-row">
            <span><i class="fas fa-chart-bar"></i> Reportes</span>
            <span><input type="checkbox" name="can_view_reports" ${(u.can_view_reports ?? true) ? 'checked' : ''}></span>
            <span class="perm-na">—</span><span class="perm-na">—</span><span class="perm-na">—</span>
          </div>
        </div>

        <label class="form-label mt-3">Permisos adicionales</label>
        <div class="perms-grid">
          <label class="perm-toggle">
            <input type="checkbox" name="can_see_cost" ${u.can_see_cost ? 'checked' : ''}>
            <span class="perm-label">
              <i class="fas fa-eye"></i>
              <strong>Ver precio de costo</strong>
              <small>Productos y reportes</small>
            </span>
          </label>
          <label class="perm-toggle">
            <input type="checkbox" name="can_export_excel" ${u.can_export_excel ? 'checked' : ''}>
            <span class="perm-label">
              <i class="fas fa-file-excel"></i>
              <strong>Exportar Excel</strong>
              <small>En todas las secciones</small>
            </span>
          </label>
        </div>
      </div>

      <div class="form-footer span-2">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar</button>
      </div>
    </form>`;
  }

  window._usr = {
    async view(id) {
      const { data } = await db.from('profiles').select('id, name, email, role, active, created_at').eq('id', id).single();
      if (!data) { toast('No se pudo cargar el usuario', 'error'); return; }
      openModal('Detalle del Usuario', detailHTML(data, getSession()?.id));
    },
    async form(id) {
      const { data } = await db.from('profiles').select('*').eq('id', id).single();
      const u = data || {};
      openModal('Editar Usuario', formHTML(u));

      // Mostrar/ocultar permisos según el rol
      document.getElementById('usr-role-select')?.addEventListener('change', e => {
        const perms = document.getElementById('perms-section');
        if (perms) perms.style.display = e.target.value === 'admin' ? 'none' : '';
      });

      document.getElementById('usr-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        setLoading(btn, true);
        const fd   = new FormData(e.target);
        const role = fd.get('role');
        const payload = {
          name: fd.get('name'),
          role,
          // permisos: siempre se guardan; admin = true por defecto vía canXxx()
          can_see_cost:           role === 'admin' ? true : fd.has('can_see_cost'),
          can_export_excel:       role === 'admin' ? true : fd.has('can_export_excel'),
          can_view_dashboard:     role === 'admin' ? true : fd.has('can_view_dashboard'),
          can_view_orders:        role === 'admin' ? true : fd.has('can_view_orders'),
          can_create_orders:      role === 'admin' ? true : fd.has('can_create_orders'),
          can_edit_orders:        role === 'admin' ? true : fd.has('can_edit_orders'),
          can_delete_orders:      role === 'admin' ? true : fd.has('can_delete_orders'),
          can_view_clients:       role === 'admin' ? true : fd.has('can_view_clients'),
          can_create_clients:     role === 'admin' ? true : fd.has('can_create_clients'),
          can_edit_clients:       role === 'admin' ? true : fd.has('can_edit_clients'),
          can_delete_clients:     role === 'admin' ? true : fd.has('can_delete_clients'),
          can_view_products:      role === 'admin' ? true : fd.has('can_view_products'),
          can_create_products:    role === 'admin' ? true : fd.has('can_create_products'),
          can_edit_products:      role === 'admin' ? true : fd.has('can_edit_products'),
          can_delete_products:    role === 'admin' ? true : fd.has('can_delete_products'),
          can_view_providers:     role === 'admin' ? true : fd.has('can_view_providers'),
          can_create_providers:   role === 'admin' ? true : fd.has('can_create_providers'),
          can_edit_providers:     role === 'admin' ? true : fd.has('can_edit_providers'),
          can_delete_providers:   role === 'admin' ? true : fd.has('can_delete_providers'),
          can_view_reports:       role === 'admin' ? true : fd.has('can_view_reports'),
          updated_at: new Date().toISOString()
        };
        const { error } = await db.from('profiles').update(payload).eq('id', id);
        setLoading(btn, false);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast('Usuario actualizado');
        closeModal(); load();
      });
    },
    async toggle(id, active) {
      const msg = active ? '¿Desactivar este usuario?' : '¿Reactivar este usuario?';
      if (!await confirm2(msg)) return;
      const { error } = await db.from('profiles').update({ active: !active }).eq('id', id);
      if (error) { toast('Error: ' + error.message, 'error'); return; }
      toast(active ? 'Usuario desactivado' : 'Usuario reactivado'); closeModal(true); load();
    }
  };

  load();
}
