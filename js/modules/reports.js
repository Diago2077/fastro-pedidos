import { db } from '../supabase.js';
import { fCurrency, fNum, enableTableSort } from '../utils/helpers.js';
import { exportPDF, exportExcel } from '../utils/export.js';
import { canSeeCost, canExportExcel } from '../auth.js';

const charts = {};
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

export async function renderReports(container) {
  container.innerHTML = `
    <div class="tabs-bar">
      <button class="tab-btn active" data-tab="season">Por Temporada</button>
      <button class="tab-btn" data-tab="seller">Por Vendedor</button>
    </div>
    <div id="report-content"></div>`;

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadReport(btn.dataset.tab);
    });
  });

  loadReport('season');
}

async function loadReport(type) {
  const el = document.getElementById('report-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-spinner"><i class="fas fa-spinner fa-spin fa-2x"></i></div>`;

  // Load orders with items
  const { data: orders } = await db.from('orders')
    .select('id, order_number, status, season, discount_pct, created_at, clients(name, city), users:profiles(name)');
  const { data: items } = await db.from('order_items')
    .select('order_id, quantity, unit_sale_price, unit_cost_price, product_variants(size, color, products(code, description))');

  const revByOrder = {};
  const costByOrder = {};
  const qtyByOrder = {};
  (items || []).forEach(i => {
    revByOrder[i.order_id]  = (revByOrder[i.order_id]  || 0) + i.quantity * i.unit_sale_price;
    costByOrder[i.order_id] = (costByOrder[i.order_id] || 0) + i.quantity * i.unit_cost_price;
    qtyByOrder[i.order_id]  = (qtyByOrder[i.order_id]  || 0) + i.quantity;
  });

  if (type === 'season') renderSeasonReport(el, orders || [], revByOrder, costByOrder, qtyByOrder);
  else                    renderSellerReport(el, orders || [], revByOrder, costByOrder, qtyByOrder);
}

// ---- BY SEASON ----
function renderSeasonReport(el, orders, revByOrder, costByOrder, qtyByOrder) {
  const showCost = canSeeCost();
  const showXls  = canExportExcel();
  const map = {};
  orders.forEach(o => {
    const s = o.season || 'Sin temporada';
    if (!map[s]) map[s] = { season: s, orders: 0, qty: 0, revenue: 0, cost: 0 };
    const rev  = (revByOrder[o.id]  || 0) * (1 - (o.discount_pct || 0) / 100);
    const cost = costByOrder[o.id] || 0;
    map[s].orders++;
    map[s].qty     += qtyByOrder[o.id] || 0;
    map[s].revenue += rev;
    map[s].cost    += cost;
  });
  const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue);

  el.innerHTML = `
    <div class="charts-grid mt-3">
      <div class="card"><div class="card-header"><h5 class="card-title">Ventas por Temporada</h5></div>
        <div class="card-body chart-wrap"><canvas id="rpt-season-bar"></canvas></div></div>
      <div class="card"><div class="card-header"><h5 class="card-title">Margen por Temporada</h5></div>
        <div class="card-body chart-wrap"><canvas id="rpt-season-margin"></canvas></div></div>
    </div>
    <div class="card mt-3">
      <div class="card-header">
        <h5 class="card-title">Detalle por Temporada</h5>
        <div class="card-actions">
          <button class="btn btn-sm btn-outline" id="rpt-s-pdf" title="Exportar PDF"><i class="fas fa-file-pdf"></i></button>
          ${showXls ? `<button class="btn btn-sm btn-outline" id="rpt-s-xls" title="Exportar Excel"><i class="fas fa-file-excel"></i></button>` : ''}
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-hover">
          <thead><tr><th>Temporada</th><th class="text-end">Pedidos</th><th class="text-end">Unidades</th><th class="text-end">Ventas</th>${showCost ? '<th class="text-end">Costo</th><th class="text-end">Margen</th>' : ''}</tr></thead>
          <tbody>
            ${rows.map(r => {
              const margin = r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue * 100) : 0;
              return `<tr>
                <td><strong>${r.season}</strong></td>
                <td class="text-end">${r.orders}</td>
                <td class="text-end">${fNum(r.qty)}</td>
                <td class="text-end">${fCurrency(r.revenue)}</td>
                ${showCost ? `<td class="text-end">${fCurrency(r.cost)}</td>
                <td class="text-end"><span class="badge ${margin > 30 ? 'badge-success' : 'badge-warning'}">${margin.toFixed(1)}%</span></td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  enableTableSort(el.querySelector('table'));

  // Bar chart
  destroyChart('rpt-season-bar');
  const ctx1 = document.getElementById('rpt-season-bar')?.getContext('2d');
  if (ctx1) charts['rpt-season-bar'] = new window.Chart(ctx1, {
    type: 'bar',
    data: { labels: rows.map(r => r.season), datasets: [
      { label: 'Ventas', data: rows.map(r => r.revenue), backgroundColor: '#9B0000', borderRadius: 4 },
      { label: 'Costo',  data: rows.map(r => r.cost),    backgroundColor: '#555',   borderRadius: 4 }
    ]},
    options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } } }
  });

  // Margin chart
  destroyChart('rpt-season-margin');
  const ctx2 = document.getElementById('rpt-season-margin')?.getContext('2d');
  if (ctx2) charts['rpt-season-margin'] = new window.Chart(ctx2, {
    type: 'doughnut',
    data: { labels: rows.map(r => r.season), datasets: [{ data: rows.map(r => r.revenue), borderWidth: 3, borderColor: '#fff' }]},
    options: { responsive: true, plugins: { legend: { position: 'right' } }, cutout: '55%' }
  });

  const COLS = [
    { key: 'season',  header: 'Temporada' },
    { key: 'orders',  header: 'Pedidos' },
    { key: 'qty',     header: 'Unidades' },
    { key: 'revenue', header: 'Ventas',  format: v => fCurrency(v) },
    ...(showCost ? [{ key: 'cost', header: 'Costo', format: v => fCurrency(v) }] : [])
  ];
  document.getElementById('rpt-s-pdf')?.addEventListener('click', () => exportPDF('Ventas por Temporada', COLS, rows, 'ventas-temporada.pdf'));
  document.getElementById('rpt-s-xls')?.addEventListener('click', () => exportExcel('Temporada', COLS, rows, 'ventas-temporada.xlsx'));
}

// ---- BY SELLER ----
function renderSellerReport(el, orders, revByOrder, costByOrder, qtyByOrder) {
  const showCost = canSeeCost();
  const showXls  = canExportExcel();
  const map = {};
  orders.forEach(o => {
    const s = o.users?.name || 'Sin asignar';
    if (!map[s]) map[s] = { seller: s, orders: 0, qty: 0, revenue: 0, cost: 0 };
    const rev  = (revByOrder[o.id]  || 0) * (1 - (o.discount_pct || 0) / 100);
    const cost = costByOrder[o.id] || 0;
    map[s].orders++;
    map[s].qty     += qtyByOrder[o.id] || 0;
    map[s].revenue += rev;
    map[s].cost    += cost;
  });
  const rows = Object.values(map).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = rows.reduce((acc, r) => acc + r.revenue, 0);

  el.innerHTML = `
    <div class="charts-grid mt-3">
      <div class="card"><div class="card-header"><h5 class="card-title">Ventas por Vendedor</h5></div>
        <div class="card-body chart-wrap"><canvas id="rpt-sell-bar"></canvas></div></div>
      <div class="card"><div class="card-header"><h5 class="card-title">Participación</h5></div>
        <div class="card-body chart-wrap"><canvas id="rpt-sell-pie"></canvas></div></div>
    </div>
    <div class="card mt-3">
      <div class="card-header">
        <h5 class="card-title">Detalle por Vendedor</h5>
        <div class="card-actions">
          <button class="btn btn-sm btn-outline" id="rpt-v-pdf" title="Exportar PDF"><i class="fas fa-file-pdf"></i></button>
          ${showXls ? `<button class="btn btn-sm btn-outline" id="rpt-v-xls" title="Exportar Excel"><i class="fas fa-file-excel"></i></button>` : ''}
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-hover">
          <thead><tr><th>Vendedor</th><th class="text-end">Pedidos</th><th class="text-end">Unidades</th><th class="text-end">Ventas</th>${showCost ? '<th class="text-end">Costo</th>' : ''}<th class="text-end">% Ventas</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const pct = totalRevenue > 0 ? (r.revenue / totalRevenue * 100) : 0;
              return `<tr>
                <td><strong>${r.seller}</strong></td>
                <td class="text-end">${r.orders}</td>
                <td class="text-end">${fNum(r.qty)}</td>
                <td class="text-end">${fCurrency(r.revenue)}</td>
                ${showCost ? `<td class="text-end">${fCurrency(r.cost)}</td>` : ''}
                <td class="text-end"><span class="badge badge-info">${pct.toFixed(1)}%</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  enableTableSort(el.querySelector('table'));

  const colors = ['#9B0000','#1a1a1a','#3182ce','#38a169','#d69e2e','#805ad5','#dd6b20'];

  destroyChart('rpt-sell-bar');
  const ctx1 = document.getElementById('rpt-sell-bar')?.getContext('2d');
  if (ctx1) charts['rpt-sell-bar'] = new window.Chart(ctx1, {
    type: 'bar',
    data: { labels: rows.map(r => r.seller), datasets: [
      { label: 'Ventas', data: rows.map(r => r.revenue), backgroundColor: rows.map((_, i) => colors[i % colors.length]), borderRadius: 4 }
    ]},
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } } } }
  });

  destroyChart('rpt-sell-pie');
  const ctx2 = document.getElementById('rpt-sell-pie')?.getContext('2d');
  if (ctx2) charts['rpt-sell-pie'] = new window.Chart(ctx2, {
    type: 'pie',
    data: { labels: rows.map(r => r.seller), datasets: [{ data: rows.map(r => r.revenue), backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }]},
    options: { responsive: true, plugins: { legend: { position: 'right' } } }
  });

  const COLS = [
    { key: 'seller',  header: 'Vendedor' },
    { key: 'orders',  header: 'Pedidos' },
    { key: 'qty',     header: 'Unidades' },
    { key: 'revenue', header: 'Ventas', format: v => fCurrency(v) },
    ...(showCost ? [{ key: 'cost', header: 'Costo', format: v => fCurrency(v) }] : []),
    { key: 'revenue', header: '% Ventas', format: v => (totalRevenue > 0 ? (v / totalRevenue * 100) : 0).toFixed(1) + '%' }
  ];
  document.getElementById('rpt-v-pdf')?.addEventListener('click', () => exportPDF('Ventas por Vendedor', COLS, rows, 'ventas-vendedor.pdf'));
  document.getElementById('rpt-v-xls')?.addEventListener('click', () => exportExcel('Vendedor', COLS, rows, 'ventas-vendedor.xlsx'));
}
