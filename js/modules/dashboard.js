import { db } from '../supabase.js';
import { fCurrency, fDate, enableTableSort, enableColumnResize, emptyState, loadingHTML, toast } from '../utils/helpers.js';
import { canSeeCost } from '../auth.js';

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

export async function renderDashboard(container) {
  const _canCost = canSeeCost();

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon si-red"><i class="fas fa-dollar-sign"></i></div>
        <div><div class="stat-value" id="s-rev">–</div><div class="stat-label">Ventas Totales</div></div>
      </div>
      ${_canCost ? `
      <div class="stat-card">
        <div class="stat-icon si-dark"><i class="fas fa-money-bill-wave"></i></div>
        <div><div class="stat-value" id="s-cost">–</div><div class="stat-label">Total Ventas en Costo</div></div>
      </div>` : ''}
      <div class="stat-card">
        <div class="stat-icon si-blue"><i class="fas fa-file-invoice"></i></div>
        <div><div class="stat-value" id="s-open">–</div><div class="stat-label">Pedidos Abiertos</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-orange"><i class="fas fa-clipboard-check"></i></div>
        <div><div class="stat-value" id="s-closed">–</div><div class="stat-label">Pedidos Cerrados</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-green"><i class="fas fa-shipping-fast"></i></div>
        <div><div class="stat-value" id="s-sent">–</div><div class="stat-label">Pedidos Enviados</div></div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="card">
        <div class="card-header"><h5 class="card-title" id="ch-sellers-title">Ventas por Vendedor</h5></div>
        <div class="card-body chart-wrap"><canvas id="ch-sellers"></canvas></div>
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

  const recentTbl = document.getElementById('recent-tbl');
  if (recentTbl) recentTbl.innerHTML = loadingHTML();

  // Load data in parallel (con manejo de error para no quedar a medio render)
  let ordersRes, itemsRes, cfgRes;
  try {
    [ordersRes, itemsRes, cfgRes] = await Promise.all([
      db.from('orders').select('id, order_number, status, discount_pct, season, created_at, clients(name), users:profiles(name)'),
      db.from('order_items').select('order_id, quantity, unit_sale_price, unit_cost_price'),
      db.from('app_config').select('value').eq('key', 'current_season').maybeSingle()
    ]);
  } catch (e) {
    container.innerHTML = emptyState('Error al cargar el panel');
    toast('Error al cargar el panel', 'error');
    return;
  }
  if (ordersRes.error || itemsRes.error) {
    container.innerHTML = emptyState('Error al cargar el panel');
    toast('Error al cargar el panel', 'error');
    return;
  }

  const orders = ordersRes.data || [];
  const items  = itemsRes.data  || [];
  const currentSeason = (cfgRes.data?.value || '').trim();

  // Revenue & cost by order
  const revByOrder = {};
  const costByOrder = {};
  items.forEach(i => {
    revByOrder[i.order_id]  = (revByOrder[i.order_id]  || 0) + i.quantity * i.unit_sale_price;
    costByOrder[i.order_id] = (costByOrder[i.order_id] || 0) + i.quantity * i.unit_cost_price;
  });

  let totalRev = 0, totalCost = 0;
  orders.forEach(o => {
    totalRev  += (revByOrder[o.id]  || 0) * (1 - (o.discount_pct || 0) / 100);
    totalCost += (costByOrder[o.id] || 0); // el costo no lleva descuento
  });

  document.getElementById('s-rev').textContent    = fCurrency(totalRev);
  if (_canCost) document.getElementById('s-cost').textContent = fCurrency(totalCost);
  document.getElementById('s-open').textContent   = orders.filter(o => o.status === 'open').length;
  document.getElementById('s-closed').textContent = orders.filter(o => o.status === 'closed').length;
  document.getElementById('s-sent').textContent   = orders.filter(o => o.status === 'sent').length;

  // Chart: ventas por vendedor — solo la temporada actual (de Configuración)
  const titleEl = document.getElementById('ch-sellers-title');
  if (titleEl) titleEl.textContent = currentSeason ? `Ventas por Vendedor — ${currentSeason}` : 'Ventas por Vendedor';

  const sellerOrders = currentSeason ? orders.filter(o => (o.season || '').trim() === currentSeason) : orders;
  const bySeller = {};
  sellerOrders.forEach(o => {
    const s = o.users?.name || 'Sin asignar';
    bySeller[s] = (bySeller[s] || 0) + (revByOrder[o.id] || 0) * (1 - (o.discount_pct || 0) / 100);
  });
  const sellerColors = ['#9B0000', '#1a1a1a', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#dd6b20'];
  destroyChart('ch-sellers');
  const ctx1 = document.getElementById('ch-sellers')?.getContext('2d');
  if (ctx1) {
    charts['ch-sellers'] = new window.Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: Object.keys(bySeller),
        datasets: [{ data: Object.values(bySeller), backgroundColor: sellerColors, borderWidth: 3, borderColor: '#fff' }]
      },
      options: { plugins: { legend: { position: 'bottom' } }, cutout: '60%', responsive: true }
    });
  }

  // Chart: ventas por temporada
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
        datasets: [{ label: 'Ventas', data: Object.values(bySeason), backgroundColor: '#9B0000', borderRadius: 5 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '₲ ' + v.toLocaleString('es-PY') } } }
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
  enableTableSort(tbl.querySelector('table'));
  enableColumnResize(tbl.querySelector('table'));
}
