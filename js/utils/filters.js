// ============================================================
// Filtro multi-selección con popover
// Reemplaza los <select> de filtro por un panel flotante con
// checkboxes (varias opciones a la vez por dimensión).
//
// Uso:
//   const mf = createMultiFilter({ button, panel, defs, onChange });
//   mf.setOptions('brand', [{ value, label }, ...]);  // tras cargar datos
//   mf.render();
//   rows.filter(mf.passes(getters));                  // aplicar
//   mf.activeCount();                                 // para el badge del botón
// ============================================================
import { esc } from './helpers.js';

export function createMultiFilter({ button, panel, defs, onChange, inline = false }) {
  const selected = {};   // key -> Set<string>
  const options  = {};   // key -> [{ value, label }]
  // Una def con `single: true` se comporta como radio (una sola opción a la vez).
  // Con `default` arranca pre-seleccionada (p.ej. estado "Abierto" en Pedidos).
  defs.forEach(d => {
    options[d.key] = [];
    selected[d.key] = ((d.single || d.dropdown) && d.default != null) ? new Set([String(d.default)]) : new Set();
  });

  function setOptions(key, opts) {
    options[key] = opts || [];
    // Descartar selecciones que ya no existen entre las opciones
    const valid = new Set(options[key].map(o => String(o.value)));
    selected[key] = new Set([...selected[key]].filter(v => valid.has(v)));
  }

  function activeCount() {
    // Las defs `single`/`dropdown` (estado) son el control principal: no cuentan como "filtro extra".
    return defs.reduce((n, d) => n + (!d.single && !d.dropdown && selected[d.key].size ? 1 : 0), 0);
  }

  function getSelected(key) { return [...(selected[key] || [])]; }

  function render() {
    if (!panel) return;
    panel.innerHTML = defs.map(d => {
      const sel = selected[d.key];
      const opts = options[d.key];
      // dropdown: <select> (un valor a la vez). single: radios. resto: checkboxes.
      let body;
      if (d.dropdown) {
        const cur = [...sel][0] ?? '';
        body = opts.length
          ? `<select class="form-control filter-select" data-key="${esc(d.key)}">
              ${opts.map(o => { const v = String(o.value); return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(o.label)}</option>`; }).join('')}
            </select>`
          : `<div class="filter-empty">— sin opciones —</div>`;
      } else {
        const type = d.single ? 'radio' : 'checkbox';
        const nameAttr = d.single ? ` name="filter-${esc(d.key)}"` : '';
        body = opts.length
          ? opts.map(o => {
              const val = String(o.value);
              return `<label class="filter-option">
                <input type="${type}"${nameAttr} data-key="${esc(d.key)}" value="${esc(val)}" ${sel.has(val) ? 'checked' : ''}>
                <span>${esc(o.label)}</span>
              </label>`;
            }).join('')
          : `<div class="filter-empty">— sin opciones —</div>`;
      }
      return `
      <div class="filter-group">
        <div class="filter-group-title">${esc(d.label)}${(!d.single && !d.dropdown && sel.size) ? ` <span class="filter-group-count">${sel.size}</span>` : ''}</div>
        <div class="filter-options">${body}</div>
      </div>`;
    }).join('') + `
      <div class="filter-popover-footer">
        <button type="button" class="btn btn-xs btn-outline" data-filter-clear><i class="fas fa-times"></i> Limpiar todo</button>
      </div>`;
  }

  // passes(getters) -> función de filtro para Array.filter
  function passes(getters) {
    return row => defs.every(d => {
      const set = selected[d.key];
      if (!set.size) return true;
      return set.has(String(getters[d.key](row)));
    });
  }

  // ---- Cambios en checkbox / radio / select (delegación) ----
  panel?.addEventListener('change', e => {
    const inp = e.target.closest('input[data-key], select[data-key]');
    if (!inp) return;
    const def = defs.find(d => d.key === inp.dataset.key);
    if (def?.single || def?.dropdown) {
      // Radio o <select>: un valor a la vez. Vacío ("Todos") => sin filtro.
      selected[inp.dataset.key] = inp.value ? new Set([inp.value]) : new Set();
    } else {
      const set = selected[inp.dataset.key];
      if (inp.checked) set.add(inp.value); else set.delete(inp.value);
      // Actualizar el contador del grupo sin re-render completo
      const title = inp.closest('.filter-group')?.querySelector('.filter-group-title');
      if (title) {
        const base = title.childNodes[0]?.textContent || '';
        title.innerHTML = `${esc(base.trim())}${set.size ? ` <span class="filter-group-count">${set.size}</span>` : ''}`;
      }
    }
    onChange?.();
  });

  panel?.addEventListener('click', e => {
    if (e.target.closest('[data-filter-clear]')) {
      // Las defs `single`/`dropdown` vuelven a su valor por defecto; las demás se vacían.
      defs.forEach(d => { selected[d.key] = ((d.single || d.dropdown) && d.default != null) ? new Set([String(d.default)]) : new Set(); });
      render();
      onChange?.();
    }
  });

  // ---- Abrir / cerrar popover ----
  // El popover usa position:fixed y se ubica por JS porque la .card tiene
  // overflow:hidden (un popover absolute se recortaría).
  const escHandler = e => { if (e.key === 'Escape') close(); };
  const reposition = () => position();
  let outsideHandler = null;

  function position() {
    if (!button || !panel) return;
    const r = button.getBoundingClientRect();
    const w = panel.offsetWidth || 260;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    panel.style.top  = (r.bottom + 6) + 'px';
    panel.style.left = left + 'px';
  }

  function open() {
    panel.classList.remove('hidden');
    position();
    outsideHandler = e => {
      if (panel.contains(e.target) || button.contains(e.target)) return;
      close();
    };
    setTimeout(() => document.addEventListener('click', outsideHandler), 0);
    document.addEventListener('keydown', escHandler);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
  }
  function close() {
    panel.classList.add('hidden');
    if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
    document.removeEventListener('keydown', escHandler);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
  }
  function toggle() { panel.classList.contains('hidden') ? open() : close(); }

  // Modo inline: el panel vive dentro del menú de acciones (siempre visible),
  // sin popover ni botón que lo abra/cierre.
  if (!inline) {
    button?.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  } else {
    panel?.classList.remove('hidden');
  }

  return { setOptions, render, activeCount, passes, getSelected, close: inline ? () => {} : close };
}
