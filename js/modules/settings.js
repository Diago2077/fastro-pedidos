import { db } from '../supabase.js';
import { toast, setLoading, esc } from '../utils/helpers.js';
import { setSizeOrderCache } from '../utils/sizes.js';
import { isPushSupported, getPermissionState, isSubscribed, enablePush, disablePush } from '../push.js';

export async function renderSettings(container) {
  container.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i></div>`;

  const [{ data: cfgData, error }, allSizes, { data: usersData }] = await Promise.all([
    db.from('app_config').select('*'),
    fetchAllSizes(),
    db.from('profiles').select('id, name, email').eq('active', true).order('name')
  ]);
  if (error) { toast('Error al cargar configuración', 'error'); return; }

  const cfg = Object.fromEntries((cfgData || []).map(r => [r.key, r.value]));

  // Reportes por correo: usuarios con email + destinatarios ya elegidos
  const reportUsers = (usersData || []).filter(u => u.email);
  const reportRecipients = (() => { try { return JSON.parse(cfg.report_recipients || '[]'); } catch { return []; } })();
  // Notificaciones push: el envío manual puede ir a cualquier usuario activo.
  const notifyUsers = (usersData || []);
  const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

  // Orden de tallas: el guardado primero (solo los que aún existen), luego las tallas nuevas
  const savedOrder = parseOrder(cfg.size_order);
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

      <div class="card">
        <div class="card-header"><h5 class="card-title"><i class="fas fa-envelope"></i> Reportes por correo</h5></div>
        <div class="card-body">
          <p class="form-hint" style="margin-bottom:12px">
            Resumen de ventas (Ventas Totales y Total en Costo globales + pedidos de los últimos 7 días
            por vendedor) enviado por correo a los usuarios elegidos.
          </p>

          <label class="form-label">Destinatarios</label>
          <div id="report-recipients" class="report-recipients">
            ${reportUsers.length ? reportUsers.map(u => `
              <label class="report-recipient">
                <input type="checkbox" value="${esc(u.id)}" ${reportRecipients.includes(u.id) ? 'checked' : ''}>
                <span class="report-recipient-info">${esc(u.name)} <small>${esc(u.email)}</small></span>
              </label>`).join('') : '<p class="text-muted" style="padding:6px 0">No hay usuarios con correo cargado.</p>'}
          </div>

          <label class="form-label" style="margin-top:14px">Envío automático</label>
          <label class="report-sched-row">
            <input type="checkbox" id="rep-weekly" ${cfg.report_weekly_enabled === 'true' ? 'checked' : ''}>
            <span>Semanal, los</span>
            <select id="rep-weekly-day" class="form-control form-control-sm report-sched-select">
              ${WEEKDAYS.map((d, i) => `<option value="${i + 1}" ${String(cfg.report_weekly_weekday || '1') === String(i + 1) ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </label>
          <label class="report-sched-row">
            <input type="checkbox" id="rep-monthly" ${cfg.report_monthly_enabled === 'true' ? 'checked' : ''}>
            <span>Mensual, el</span>
            <select id="rep-monthly-day" class="form-control form-control-sm report-sched-select">
              ${Array.from({ length: 28 }, (_, i) => i + 1).map(d => `<option value="${d}" ${String(cfg.report_monthly_day || '1') === String(d) ? 'selected' : ''}>día ${d}</option>`).join('')}
            </select>
          </label>

          <div class="form-footer" style="gap:8px">
            <button type="button" class="btn btn-outline" id="btn-send-report-now"><i class="fas fa-paper-plane"></i> Enviar ahora</button>
            <button type="button" class="btn btn-accent" id="btn-save-report-cfg"><i class="fas fa-save"></i> Guardar</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h5 class="card-title"><i class="fas fa-bell"></i> Notificaciones</h5></div>
        <div class="card-body">
          <p class="form-hint" style="margin-bottom:12px">
            Avisos al celular/PC (incluso con la app cerrada) cuando un pedido cambia de estado.
            Llegan a los <strong>mismos usuarios marcados arriba en “Reportes por correo”</strong>
            (excepto a quien hizo el cambio) que además hayan activado las notificaciones en su dispositivo.
          </p>

          <label class="form-label">Este dispositivo</label>
          <div class="notif-device">
            <span id="notif-status" class="notif-status">Comprobando…</span>
            <button type="button" class="btn btn-outline" id="btn-notif-toggle" disabled>…</button>
          </div>
          <small class="form-hint" style="display:block;margin-top:6px">
            En iPhone/iPad hay que instalar la app en la pantalla de inicio para recibir avisos.
          </small>

          <label class="form-label" style="margin-top:16px">Enviar notificación manual</label>
          <div class="notif-manual">
            ${notifyUsers.length ? notifyUsers.map(u => `
              <div class="notif-manual-row" data-user="${esc(u.id)}">
                <span class="notif-manual-name">${esc(u.name)}</span>
                <input type="text" class="form-control form-control-sm notif-manual-msg" placeholder="Mensaje…">
                <button type="button" class="btn btn-sm btn-accent notif-manual-send" title="Enviar"><i class="fas fa-paper-plane"></i></button>
              </div>`).join('') : '<p class="text-muted" style="padding:6px 0">No hay usuarios activos.</p>'}
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

  // ---- Reportes por correo ----
  const reportRecipientIds = () =>
    [...document.querySelectorAll('#report-recipients input:checked')].map(c => c.value);

  async function saveReportConfig() {
    const now = new Date().toISOString();
    return db.from('app_config').upsert([
      { key: 'report_recipients',      value: JSON.stringify(reportRecipientIds()),                 updated_at: now },
      { key: 'report_weekly_enabled',  value: String(document.getElementById('rep-weekly').checked), updated_at: now },
      { key: 'report_weekly_weekday',  value: document.getElementById('rep-weekly-day').value,        updated_at: now },
      { key: 'report_monthly_enabled', value: String(document.getElementById('rep-monthly').checked), updated_at: now },
      { key: 'report_monthly_day',     value: document.getElementById('rep-monthly-day').value,       updated_at: now },
    ], { onConflict: 'key' });
  }

  document.getElementById('btn-save-report-cfg')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-report-cfg');
    setLoading(btn, true);
    const { error } = await saveReportConfig();
    setLoading(btn, false);
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    toast('Configuración de reportes guardada');
  });

  document.getElementById('btn-send-report-now')?.addEventListener('click', async () => {
    const ids = reportRecipientIds();
    if (!ids.length) { toast('Elegí al menos un destinatario', 'warning'); return; }
    const btn = document.getElementById('btn-send-report-now');
    setLoading(btn, true);
    // Guardar la selección actual para que la función use estos destinatarios
    await saveReportConfig();
    const { data, error } = await db.functions.invoke('send-report', { body: { mode: 'manual' } });
    setLoading(btn, false);
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {}
      toast('No se pudo enviar: ' + msg, 'error');
      return;
    }
    if (data?.error) { toast('No se pudo enviar: ' + data.error, 'error'); return; }
    toast(`Reporte enviado a ${data?.sent ?? ids.length} destinatario(s)`);
  });

  // ---- Notificaciones: activar/desactivar en este dispositivo ----
  const notifStatusEl = document.getElementById('notif-status');
  const notifToggleEl = document.getElementById('btn-notif-toggle');

  async function refreshNotifUI() {
    if (!notifStatusEl || !notifToggleEl) return;
    if (!isPushSupported()) {
      notifStatusEl.textContent = 'No soportado en este dispositivo';
      notifToggleEl.classList.add('hidden');
      return;
    }
    if (getPermissionState() === 'denied') {
      notifStatusEl.textContent = 'Bloqueadas en el navegador';
      notifToggleEl.classList.add('hidden');
      return;
    }
    const on = await isSubscribed();
    notifStatusEl.textContent = on ? 'Activadas en este dispositivo' : 'Desactivadas';
    notifToggleEl.classList.remove('hidden');
    notifToggleEl.disabled = false;
    notifToggleEl.dataset.on = on ? '1' : '0';
    notifToggleEl.innerHTML = on
      ? '<i class="fas fa-bell-slash"></i> Desactivar'
      : '<i class="fas fa-bell"></i> Activar';
  }

  notifToggleEl?.addEventListener('click', async () => {
    setLoading(notifToggleEl, true);
    try {
      if (notifToggleEl.dataset.on === '1') { await disablePush(); toast('Notificaciones desactivadas'); }
      else { await enablePush(); toast('Notificaciones activadas en este dispositivo'); }
    } catch (e) {
      toast(e.message || 'No se pudo cambiar', 'error');
    } finally {
      setLoading(notifToggleEl, false);
      refreshNotifUI();
    }
  });

  // ---- Notificaciones: envío manual por usuario ----
  document.querySelector('.notif-manual')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.notif-manual-send');
    if (!btn) return;
    const row = btn.closest('.notif-manual-row');
    const userId = row?.dataset.user;
    const input = row?.querySelector('.notif-manual-msg');
    const message = (input?.value || '').trim();
    if (!userId) return;
    if (!message) { toast('Escribí un mensaje', 'warning'); return; }

    setLoading(btn, true);
    const { data, error } = await db.functions.invoke('send-push', { body: { type: 'manual', userId, message } });
    setLoading(btn, false);
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch {}
      toast('No se pudo enviar: ' + msg, 'error');
      return;
    }
    if (data?.error) { toast('No se pudo enviar: ' + data.error, 'error'); return; }
    if (!data?.sent) { toast('El usuario no tiene dispositivos con notificaciones activas', 'warning'); return; }
    toast(`Notificación enviada (${data.sent} dispositivo/s)`);
    if (input) input.value = '';
  });

  refreshNotifUI();
  renderList();
}

// Lee TODAS las tallas distintas de product_variants paginando, porque Supabase
// devuelve como máximo 1000 filas por consulta (si no, faltarían tallas).
async function fetchAllSizes() {
  const sizes = new Set();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db.from('product_variants')
      .select('size').range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    data.forEach(v => { const s = String(v.size || '').trim(); if (s) sizes.add(s); });
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return [...sizes];
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
