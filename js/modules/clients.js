import { db } from '../supabase.js';
import { toast, openModal, closeModal, confirm2, emptyState, setLoading, debounce, esc } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';
import { canExportExcel, canCreateClients, canEditClients, canDeleteClients } from '../auth.js';

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
          ${canExportExcel() ? `<button class="btn btn-sm btn-outline" onclick="window._cl.xls()"><i class="fas fa-file-excel"></i> Excel</button>` : ''}
          ${canCreateClients() ? `<button class="btn btn-sm btn-outline" onclick="window._cl.importExcel()"><i class="fas fa-file-upload"></i> Importar</button>` : ''}
          ${canCreateClients() ? `<button class="btn btn-accent" onclick="window._cl.form()"><i class="fas fa-plus"></i> Nuevo</button>` : ''}
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
            ${canEditClients()   ? `<button class="btn btn-xs btn-outline" onclick="window._cl.form('${c.id}')"><i class="fas fa-edit"></i></button>` : ''}
            ${canDeleteClients() ? `<button class="btn btn-xs btn-danger-outline" onclick="window._cl.del('${c.id}')"><i class="fas fa-trash"></i></button>` : ''}
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
    xls() { exportExcel('Clientes', COLS, _all, 'clientes.xlsx'); },
    importExcel() { openClientImportModal(load); },
    downloadTemplate: downloadClientTemplate
  };

  document.getElementById('q-clients')?.addEventListener('input', debounce(e => load(e.target.value.trim()), 300));
  load();
}

// ============================================================
// IMPORTACIÓN DESDE EXCEL
// ============================================================

function normalizeHeader(h) {
  return String(h).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/[^a-z0-9]/g, '');                       // solo alfanumérico
}

const CLIENT_HEADER_MAP = {
  nombre:            'name',
  name:              'name',
  cliente:           'name',
  nombretienda:      'store_name',
  nombredetienda:    'store_name',
  tienda:            'store_name',
  store:             'store_name',
  storename:         'store_name',
  ruc:               'ruc',
  cedula:            'ruc',
  ci:                'ruc',
  documento:         'ruc',
  nrodocumento:      'ruc',
  telefono:          'phone',
  tel:               'phone',
  celular:           'phone',
  movil:             'phone',
  phone:             'phone',
  ciudad:            'city',
  city:              'city',
  localidad:         'city',
  correo:            'email',
  correoelectronico: 'email',
  email:             'email',
  mail:              'email',
};

function parseClientRows(sheet) {
  const raw = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (raw.length < 2) return { rows: [], errors: ['El archivo no tiene datos'] };

  const headers = raw[0].map(h => CLIENT_HEADER_MAP[normalizeHeader(h)] || null);
  if (!headers.includes('name')) {
    return { rows: [], errors: ['Falta la columna obligatoria: Nombre'] };
  }

  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const rowRaw = raw[i];
    if (rowRaw.every(c => !c)) continue; // saltar filas vacías
    const row = {};
    headers.forEach((field, idx) => { if (field) row[field] = rowRaw[idx]; });
    if (!row.name || !String(row.name).trim()) continue;
    rows.push({
      name:       String(row.name).trim(),
      store_name: row.store_name ? String(row.store_name).trim() : '',
      ruc:        row.ruc   ? String(row.ruc).trim()   : '',
      phone:      row.phone ? String(row.phone).trim() : '',
      city:       row.city  ? String(row.city).trim()  : '',
      email:      row.email ? String(row.email).trim() : '',
    });
  }
  return { rows, errors: [] };
}

function openClientImportModal(reloadFn) {
  const html = `
    <div class="import-wrap">
      <div class="import-info">
        <p class="mb-2"><strong>Formato:</strong> una fila por cliente. Sólo <strong>Nombre</strong> es obligatorio.</p>
        <table class="table table-sm table-bordered" style="font-size:.82em">
          <thead><tr><th>Columna</th><th>Descripción</th><th>Req.</th></tr></thead>
          <tbody>
            <tr><td><code>Nombre</code></td><td>Nombre del cliente</td><td>✓</td></tr>
            <tr><td><code>Tienda</code></td><td>Nombre de la tienda</td><td></td></tr>
            <tr><td><code>RUC</code></td><td>RUC / cédula</td><td></td></tr>
            <tr><td><code>Telefono</code></td><td>Teléfono de contacto</td><td></td></tr>
            <tr><td><code>Ciudad</code></td><td>Ciudad</td><td></td></tr>
            <tr><td><code>Correo</code></td><td>Correo electrónico</td><td></td></tr>
          </tbody>
        </table>
        <button class="btn btn-sm btn-outline" onclick="window._cl.downloadTemplate()">
          <i class="fas fa-download"></i> Descargar plantilla de ejemplo
        </button>
      </div>

      <div class="dropzone" id="import-dropzone">
        <i class="fas fa-file-excel" style="font-size:2.5em;color:#38a169;margin-bottom:10px"></i>
        <p style="margin-bottom:10px;color:var(--text-muted)">Arrastra tu archivo aquí o</p>
        <label class="btn btn-outline" style="cursor:pointer">
          <i class="fas fa-folder-open"></i> Seleccionar archivo (.xlsx / .xls / .csv)
          <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" hidden>
        </label>
        <p id="import-filename" style="margin-top:8px;font-size:.8em;color:var(--text-muted)"></p>
      </div>

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

  openModal('Importar Clientes desde Excel', html, { size: 'lg' });

  const fileInput = document.getElementById('import-file-input');
  const dropzone  = document.getElementById('import-dropzone');

  fileInput?.addEventListener('change', e => handleFile(e.target.files[0]));
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
      const { rows, errors } = parseClientRows(sheet);
      if (errors.length) { toast(errors[0], 'error'); return; }
      if (!rows.length) { toast('No se encontraron clientes válidos en el archivo', 'warning'); return; }
      _parsedRows = rows;
      showPreview(rows);
    };
    reader.readAsArrayBuffer(file);
  }

  function showPreview(rows) {
    document.getElementById('import-summary').innerHTML = `
      <div class="import-summary-box">
        <span><i class="fas fa-users"></i> <strong>${rows.length}</strong> clientes en el archivo</span>
      </div>`;

    document.getElementById('import-preview-table').innerHTML = `
      <table class="table table-sm table-bordered">
        <thead><tr><th>Nombre</th><th>Tienda</th><th>RUC</th><th>Teléfono</th><th>Ciudad</th><th>Correo</th></tr></thead>
        <tbody>
          ${rows.slice(0, 50).map(r => `<tr>
            <td>${esc(r.name)}</td><td>${esc(r.store_name)}</td><td>${esc(r.ruc)}</td>
            <td>${esc(r.phone)}</td><td>${esc(r.city)}</td><td>${esc(r.email)}</td>
          </tr>`).join('')}
          ${rows.length > 50 ? `<tr><td colspan="6" class="text-center text-muted">… y ${rows.length - 50} filas más</td></tr>` : ''}
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
      const result = await executeClientImport(_parsedRows);
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

async function executeClientImport(rows) {
  let created = 0, updated = 0, errors = 0;

  // Cargar clientes activos existentes para evitar duplicados (match por RUC o por nombre)
  const { data: existing } = await db.from('clients').select('id, name, ruc').eq('active', true);
  const byRuc  = {};
  const byName = {};
  (existing || []).forEach(c => {
    if (c.ruc) byRuc[String(c.ruc).trim().toLowerCase()] = c.id;
    byName[String(c.name).trim().toLowerCase()] = c.id;
  });

  for (const r of rows) {
    try {
      const payload = {
        name:       r.name,
        store_name: r.store_name || null,
        ruc:        r.ruc   || null,
        phone:      r.phone || null,
        city:       r.city  || null,
        email:      r.email || null,
      };

      const matchId = (r.ruc && byRuc[r.ruc.toLowerCase()]) || byName[r.name.toLowerCase()];

      if (matchId) {
        const { error } = await db.from('clients').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', matchId);
        if (error) throw error;
        updated++;
      } else {
        const { data, error } = await db.from('clients').insert(payload).select('id').single();
        if (error) throw error;
        // registrar el nuevo para evitar duplicados dentro del mismo archivo
        if (r.ruc) byRuc[r.ruc.toLowerCase()] = data.id;
        byName[r.name.toLowerCase()] = data.id;
        created++;
      }
    } catch {
      errors++;
    }
  }

  return { created, updated, errors };
}

function downloadClientTemplate() {
  const data = [
    ['Nombre', 'Tienda', 'RUC', 'Telefono', 'Ciudad', 'Correo'],
    ['Juan Pérez',    'Tienda Centro',   '1234567-8', '0981 123 456', 'Asunción',     'juan@ejemplo.com'],
    ['María Gómez',   'Boutique María',  '8765432-1', '0972 654 321', 'Ciudad del Este', 'maria@ejemplo.com'],
    ['Carlos Benítez','Multitienda CB',  '4567890-2', '0961 555 777', 'Encarnación',  ''],
  ];
  const ws = window.XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [20, 20, 15, 16, 16, 24].map(w => ({ wch: w }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  window.XLSX.writeFile(wb, 'plantilla-clientes.xlsx');
}
