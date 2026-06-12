// ============================================================
// Orden de tallas centralizado
// El orden se define en Configuración y se guarda en app_config
// (key = 'size_order', value = JSON con el array de tallas).
// Todas las vistas (pedido, edición y tabla de productos) usan
// sortSizes() para mostrar las tallas en el mismo orden.
// ============================================================
import { db } from '../supabase.js';

let _order = [];   // array de tallas en el orden definido por el usuario

// Comparación "natural" para tallas no configuradas (1, 2, 10 en vez de 1, 10, 2)
function natural(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Carga el orden guardado desde app_config (una vez, al arrancar la app)
export async function loadSizeOrder() {
  try {
    const { data } = await db.from('app_config').select('value').eq('key', 'size_order').maybeSingle();
    _order = parse(data?.value);
  } catch (e) {
    _order = [];
  }
  return _order;
}

function parse(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.map(s => String(s)) : [];
  } catch (e) {
    return [];
  }
}

// Orden actual en memoria (copia)
export function getSizeOrder() {
  return [..._order];
}

// Actualiza la copia en memoria (tras guardar en Configuración, sin recargar)
export function setSizeOrderCache(arr) {
  _order = (arr || []).map(s => String(s));
}

// Índice de una talla en el orden definido (Infinity si no está configurada)
function indexOf(size) {
  const i = _order.indexOf(String(size));
  return i === -1 ? Infinity : i;
}

// Compara dos tallas según el orden definido; las no configuradas van al final
export function compareSize(a, b) {
  const ia = indexOf(a), ib = indexOf(b);
  if (ia !== ib) return ia - ib;
  return natural(a, b);
}

// Devuelve una copia ordenada del array de tallas
export function sortSizes(sizes) {
  return [...sizes].sort(compareSize);
}
