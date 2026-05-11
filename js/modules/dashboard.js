import { db } from '../supabase.js';
import { fCurrency, fDate } from '../utils/helpers.js';

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

export async function renderDashboard(container) {
  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon si-blue"><i class="fas fa-file-invoice"></i></div>
        <div><div class="stat-value" id="s-open">–</div><div class="stat-label">Pedidos Abiertos</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-green"><i class="fas fa-shipping-fast"></i></div>
        <div><div class="stat-value" id="s-sent">–</div><div class="stat-label">Pedidos Enviados</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-red"><i class="fas fa-dollar-sign"></i></div>
        <div><div class="stat-value" id="s-rev">–</div><div class="stat-label">Ventas Totales</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-orange"><i class="fas fa-boxes"></i></div>
        <div><div class="stat-value" id="s-prods">–</div><div class="stat-label">Productos Activos</div></div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="card">
        <div class="card-header"><h5 class="card-title">Pedidos por Estado</h5></div>
        <div class="card-body chart-wrap"><canvas id="ch-status"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><h5 class="card-title">Ventas por Temporada</h5></div>
        <div class="card-body chart-wrap"><canvas id="ch-season"></canvas></div>
      </div>
    </div>

    <div class="card mt-4">
      <div class="card-header"><h5 class="card-title">Últimos Pedidos</h5></div>
      <div class="table-responsive" id="recent-tbl"></div>
    </div>`;

  // Load all data in parallel
  const [ordersRes, itemsRes, prodsRes] = await Promise.all([
    db.from('orders').select('id, order_number, status, discount_pct, season, created_at, clients(name), users(name)'),
    db.from('order_items').select('order_id, quantity, unit_sale_price'),
    db.from('products').select('id', { count: 'exact', head: true }).eq('active', true)
  ]);

  const orders = ordersRes.data || [];
  const items  = itemsRes.data  || [];
  const prodCount = prodsRes.count || 0;

  // Revenue by order
  const revByOrder = {};
  items.forEach(i => { revByOrder[i.order_id] = (revByOrder[i.order_id] || 0) + i.quantity * i.unit_sale_price; });

  let totalRev = 0;
  orders.forEach(o => { totalRev += (revByOrder[o.id] || 0) * (1 - (o.discount_pct || 0) / 100); });

  document.getElementById('s-open').textContent  = orders.filter(o => o.status === 'open').length;
  document.getElementById('s-sent').textContent  = orders.filter(o => o.status === 'sent').length;
  document.getElementById('s-rev').textContent   = fCurrency(totalRev);
  document.getElementById('s-prods').textContent = prodCount;

  // Chart: status
  destroyChart('ch-status');
  const ctx1 = document.getElementById('ch-status')?.getContext('2d');
  if (ctx1) {
    charts['ch-status'] = new window.Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: ['Abiertos', 'Cerrados', 'Enviados'],
        datasets: [{ data: [
          orders.filter(o => o.status === 'open').length,
          orders.filter(o => o.status === 'closed').length,
          orders.filter(o => o.status === 'sent').length
        ], backgroundColor: ['#3182ce', '#d69e2e', '#38a169'], borderWidth: 3, borderColor: '#fff' }]
      },
      options: { plugins: { legend: { position: 'bottom' } }, cutout: '68%', responsive: true }
    });
  }

  // Chart: sales by season
  const bySeason = {};
  orders.forEach(o => {
    const s = o.season || 'Sin temporada';
    bySeason[s] = (bySeason[s] || 0) + (revByOrder[o.id] || 0) * (1 - (o.discount_pct || 0) / 100);
  });
  destroyChart('ch-season');
  const ctx2 = document.getElementById('ch-season')?.getContext('2d');
  if (ctx2) {
    charts['ch-season'] = new window.Chart(ctx2, {
      type: 'bar',
      data: {
        labels: Object.keys(bySeason),
        datasets: [{ label: 'Ventas ($)', data: Object.values(bySeason), backgroundColor: '#9B0000', borderRadius: 5 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString('es-EC') } } }
      }
    });
  }

  // Recent orders table
  const recent = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
  const tbl = document.getElementById('recent-tbl');
  if (!recent.length) { tbl.innerHTML = '<p class="p-3 text-muted">No hay pedidos aún.</p>'; return; }

  const statusBadge = s => {
    const m = { open: ['Abierto', 'info'], closed: ['Cerrado', 'warning'], sent: ['Enviado', 'success'] };
    const [l, t] = m[s] || [s, 'secondary'];
    return `<span class="badge badge-${t}">${l}</span>`;
  };

  tbl.innerHTML = `<table class="table table-hover">
    <thead><tr><th>N° Pedido</th><th>Cliente</th><th>Vendedor</th><th>Temporada</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead>
    <tbody>
      ${recent.map(o => {
        const sub = revByOrder[o.id] || 0;
        const tot = sub * (1 - (o.discount_pct || 0) / 100);
        return `<tr>
          <td><strong>${o.order_number}</strong></td>
          <td>${o.clients?.name || '–'}</td>
          <td>${o.users?.name || '–'}</td>
          <td>${o.season || '–'}</td>
          <td>${fCurrency(tot)}</td>
          <td>${statusBadge(o.status)}</td>
          <td>${fDate(o.created_at)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}
