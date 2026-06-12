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

export function createMultiFilter({ button, panel, defs, onChange }) {
  const selected = {};   // key -> Set<string>
  const options  = {};   // key -> [{ value, label }]
  defs.forEach(d => { selected[d.key] = new Set(); options[d.key] = []; });

  function setOptions(key, opts) {
    options[key] = opts || [];
    // Descartar selecciones que ya no existen entre las opciones
    const valid = new Set(options[key].map(o => String(o.value)));
    selected[key] = new Set([...selected[key]].filter(v => valid.has(v)));
  }

  function activeCount() {
    return defs.reduce((n, d) => n + (selected[d.key].size ? 1 : 0), 0);
  }

  function render() {
    if (!panel) return;
    panel.innerHTML = defs.map(d => {
      const sel = selected[d.key];
      const opts = options[d.key];
      return `
      <div class="filter-group">
        <div class="filter-group-title">${esc(d.label)}${sel.size ? ` <span class="filter-group-count">${sel.size}</span>` : ''}</div>
        <div class="filter-options">
          ${opts.length
            ? opts.map(o => {
                const val = String(o.value);
                return `<label class="filter-option">
                  <input type="checkbox" data-key="${esc(d.key)}" value="${esc(val)}" ${sel.has(val) ? 'checked' : ''}>
                  <span>${esc(o.label)}</span>
                </label>`;
              }).join('')
            : `<div class="filter-empty">— sin opciones —</div>`}
        </div>
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

  // ---- Cambios en checkboxes (delegación) ----
  panel?.addEventListener('change', e => {
    const chk = e.target.closest('input[type=checkbox][data-key]');
    if (!chk) return;
    const set = selected[chk.dataset.key];
    if (chk.checked) set.add(chk.value); else set.delete(chk.value);
    // Actualizar el contador del grupo sin re-render completo
    const title = chk.closest('.filter-group')?.querySelector('.filter-group-title');
    if (title) {
      const base = title.childNodes[0]?.textContent || '';
      title.innerHTML = `${esc(base.trim())}${set.size ? ` <span class="filter-group-count">${set.size}</span>` : ''}`;
    }
    onChange?.();
  });

  panel?.addEventListener('click', e => {
    if (e.target.closest('[data-filter-clear]')) {
      defs.forEach(d => selected[d.key].clear());
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

  button?.addEventListener('click', e => { e.stopPropagation(); toggle(); });

  return { setOptions, render, activeCount, passes, close };
}
