import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, hashPwd, esc } from '../utils/helpers.js';
import { getSession } from '../auth.js';

export async function renderUsers(container) {
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-actions">
          <button class="btn btn-accent" onclick="window._usr.form()"><i class="fas fa-plus"></i> Nuevo Usuario</button>
        </div>
      </div>
      <div class="table-responsive" id="usr-tbl"></div>
    </div>`;

  async function load() {
    const { data, error } = await db.from('users').select('id, name, email, role, active, created_at').order('name');
    if (error) { toast('Error al cargar usuarios', 'error'); return; }
    render(data || []);
  }

  function render(rows) {
    const el = document.getElementById('usr-tbl');
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState('No hay usuarios'); return; }
    const currentId = getSession()?.id;
    el.innerHTML = `<table class="table table-hover">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Creado</th><th></th></tr></thead>
      <tbody>
        ${rows.map(u => `<tr>
          <td><strong>${esc(u.name)}</strong>${u.id === currentId ? ' <span class="badge badge-info">Yo</span>' : ''}</td>
          <td>${esc(u.email)}</td>
          <td><span class="badge ${u.role === 'admin' ? 'badge-danger' : 'badge-secondary'}">${u.role === 'admin' ? 'Admin' : 'Usuario'}</span></td>
          <td><span class="badge ${u.active ? 'badge-success' : 'badge-secondary'}">${u.active ? 'Activo' : 'Inactivo'}</span></td>
          <td>${new Date(u.created_at).toLocaleDateString('es-EC')}</td>
          <td class="td-actions">
            <button class="btn btn-xs btn-outline" onclick="window._usr.form('${u.id}')"><i class="fas fa-edit"></i></button>
            ${u.id !== currentId ? `<button class="btn btn-xs btn-danger-outline" onclick="window._usr.toggle('${u.id}', ${u.active})">
              <i class="fas fa-${u.active ? 'ban' : 'check'}"></i></button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function formHTML(u = {}) {
    const isEdit = !!u.id;
    return `<form id="usr-form" class="form-grid-2">
      <div class="form-group">
        <label class="form-label req">Nombre</label>
        <input type="text" name="name" class="form-control" value="${esc(u.name || '')}" required>
      </div>
      <div class="form-group">
        <label class="form-label req">Correo Electrónico</label>
        <input type="email" name="email" class="form-control" value="${esc(u.email || '')}" required ${isEdit ? 'readonly' : ''}>
      </div>
      <div class="form-group">
        <label class="form-label ${isEdit ? '' : 'req'}">Contraseña ${isEdit ? '(dejar vacío para no cambiar)' : ''}</label>
        <input type="password" name="password" class="form-control" ${isEdit ? '' : 'required'} minlength="6" placeholder="Mínimo 6 caracteres">
      </div>
      <div class="form-group">
        <label class="form-label">Rol</label>
        <select name="role" class="form-control">
          <option value="user" ${u.role === 'user' ? 'selected' : ''}>Usuario</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
        </select>
      </div>
      <div class="form-footer span-2">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn btn-accent"><i class="fas fa-save"></i> Guardar</button>
      </div>
    </form>`;
  }

  window._usr = {
    async form(id) {
      let u = {};
      if (id) { const { data } = await db.from('users').select('*').eq('id', id).single(); u = data || {}; }
      openModal(id ? 'Editar Usuario' : 'Nuevo Usuario', formHTML(u));
      document.getElementById('usr-form').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('[type=submit]');
        setLoading(btn, true);
        const fd = new FormData(e.target);
        const pwd = fd.get('password');
        const payload = { name: fd.get('name'), role: fd.get('role'), updated_at: new Date().toISOString() };
        if (pwd) payload.password_hash = await hashPwd(pwd);
        if (!id) {
          payload.email  = fd.get('email').toLowerCase().trim();
          if (!payload.password_hash) { toast('La contraseña es requerida', 'warning'); setLoading(btn, false); return; }
        }
        const { error } = id
          ? await db.from('users').update(payload).eq('id', id)
          : await db.from('users').insert(payload);
        setLoading(btn, false);
        if (error) { toast('Error: ' + error.message, 'error'); return; }
        toast(id ? 'Usuario actualizado' : 'Usuario creado');
        closeModal(); load();
      });
    },
    async toggle(id, active) {
      const msg = active ? '¿Desactivar este usuario?' : '¿Reactivar este usuario?';
      if (!await confirm2(msg)) return;
      await db.from('users').update({ active: !active }).eq('id', id);
      toast(active ? 'Usuario desactivado' : 'Usuario reactivado'); load();
    }
  };

  load();
}
