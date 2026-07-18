import { db } from '../supabase.js';
import { fCurrency, fMoney, fDate, enableTableSort, enableColumnResize, emptyState, loadingHTML, toast, fetchAllRows, esc } from '../utils/helpers.js';
import { canSeeCost } from '../auth.js';

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

export async function renderDashboard(container) {
  const _canCost = canSeeCost();

  container.innerHTML = `
    <div class="dash-toolbar">
      <button class="btn btn-sm btn-outline" id="dash-pdf" title="Descargar Dashboard en PDF"><i class="fas fa-file-pdf"></i> Descargar PDF</button>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon si-red stat-icon-text">Gs</div>
        <div><div class="stat-value" id="s-rev">–</div><div class="stat-label">Ventas Totales</div></div>
      </div>
      ${_canCost ? `
      <div class="stat-card">
        <div class="stat-icon si-dark stat-icon-text">$</div>
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
  // fetchAllRows: Supabase corta en 1000 filas por consulta; con .order('id')
  // pagina de forma estable hasta traer TODO (si no, los totales quedarían
  // truncados en silencio al superar 1000 pedidos u order_items).
  let ordersRes, itemsRes, cfgRes;
  try {
    [ordersRes, itemsRes, cfgRes] = await Promise.all([
      fetchAllRows(() => db.from('orders').select('id, order_number, status, discount_pct, season, created_at, clients(name), users:profiles(name)').order('id')),
      fetchAllRows(() => db.from('order_items').select('order_id, quantity, unit_sale_price, unit_cost_price').order('id')),
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

  // Los pedidos Cancelados no suman en KPIs, gráficos ni en "Últimos Pedidos".
  const orders = (ordersRes.data || []).filter(o => o.status !== 'cancelled');
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

  const nOpen   = orders.filter(o => o.status === 'open').length;
  const nClosed = orders.filter(o => o.status === 'closed').length;
  const nSent   = orders.filter(o => o.status === 'sent').length;

  document.getElementById('s-rev').textContent    = fCurrency(totalRev);          // Guaraníes
  if (_canCost) document.getElementById('s-cost').textContent = fMoney(totalCost, '$'); // Dólares
  document.getElementById('s-open').textContent   = nOpen;
  document.getElementById('s-closed').textContent = nClosed;
  document.getElementById('s-sent').textContent   = nSent;

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

  const STATUS_LABEL = { open: 'Abierto', closed: 'Cerrado', sent: 'Enviado' };
  const statusBadge = s => {
    const t = { open: 'info', closed: 'warning', sent: 'success' }[s] || 'secondary';
    return `<span class="badge badge-${t}">${STATUS_LABEL[s] || s}</span>`;
  };

  // Botón "Descargar PDF": arma un PDF con KPIs, gráficos y últimos pedidos.
  const pdfBtn = document.getElementById('dash-pdf');
  if (pdfBtn) pdfBtn.onclick = () => exportDashboardPDF({
    canCost: _canCost,
    totalRev, totalCost,
    nOpen, nClosed, nSent,
    sellerTitle: titleEl?.textContent || 'Ventas por Vendedor',
    recent: recent.map(o => ({
      order_number: o.order_number,
      client: o.clients?.name || '–',
      seller: o.users?.name || '–',
      season: o.season || '–',
      total: (revByOrder[o.id] || 0) * (1 - (o.discount_pct || 0) / 100),
      status: STATUS_LABEL[o.status] || o.status,
      date: fDate(o.created_at)
    }))
  });

  if (!recent.length) { tbl.innerHTML = '<p class="p-3 text-muted">No hay pedidos aún.</p>'; return; }

  tbl.innerHTML = `<table class="table table-hover">
    <thead><tr><th>N° Pedido</th><th>Cliente</th><th>Vendedor</th><th>Temporada</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead>
    <tbody>
      ${recent.map(o => {
        const sub = revByOrder[o.id] || 0;
        const tot = sub * (1 - (o.discount_pct || 0) / 100);
        return `<tr>
          <td><strong>${esc(o.order_number)}</strong></td>
          <td>${esc(o.clients?.name || '–')}</td>
          <td>${esc(o.users?.name || '–')}</td>
          <td>${esc(o.season || '–')}</td>
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

// ============================================================
// Descargar TODO el Dashboard en un PDF: KPIs + gráficos + últimos pedidos.
// Los gráficos se toman de los <canvas> en pantalla (toDataURL).
// ============================================================
function exportDashboardPDF(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 14; // margen lateral

  // --- Cabecera ---
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13); doc.setFont('helvetica', 'bold');
  doc.text('FASTRO S.A.', M, 10);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('Dashboard — Resumen general', M, 17);
  doc.text(`Generado: ${new Date().toLocaleDateString('es-PY')}`, pageW - M, 17, { align: 'right' });

  // --- KPIs (tabla de 2 columnas) ---
  // En el PDF el símbolo ₲ no existe en la fuente (saldría "²"): usamos "Gs".
  const kpis = [
    ['Ventas Totales (Gs)', fMoney(d.totalRev, 'Gs')],
    ...(d.canCost ? [['Total Ventas en Costo ($)', fMoney(d.totalCost, '$')]] : []),
    ['Pedidos Abiertos', String(d.nOpen)],
    ['Pedidos Cerrados', String(d.nClosed)],
    ['Pedidos Enviados', String(d.nSent)]
  ];
  doc.autoTable({
    startY: 28,
    head: [['Indicador', 'Valor']],
    body: kpis,
    headStyles: { fillColor: [155, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    styles: { cellPadding: 3 },
    margin: { left: M, right: M }
  });

  // --- Gráficos (lado a lado) ---
  let y = doc.lastAutoTable.finalY + 10;
  const usableW = pageW - M * 2;
  const gap = 10;
  const colW = (usableW - gap) / 2;
  const MAX_CHART_H = 55; // alto máximo de cada gráfico (mm)
  const addChart = (canvasId, title, x) => {
    const cv = document.getElementById(canvasId);
    if (!cv || !cv.width) return 0;
    try {
      const img = cv.toDataURL('image/png', 1.0);
      const ratio = cv.height / cv.width;
      let w = colW, h = w * ratio;
      if (h > MAX_CHART_H) { h = MAX_CHART_H; w = h / ratio; } // achicar manteniendo proporción
      const cx = x + (colW - w) / 2; // centrar dentro de la columna
      doc.setTextColor(33, 33, 33);
      doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.text(title, x, y);
      doc.addImage(img, 'PNG', cx, y + 3, w, h);
      return h;
    } catch (_) { return 0; }
  };
  const h1 = addChart('ch-sellers', d.sellerTitle, M);
  const h2 = addChart('ch-season', 'Ventas por Temporada', M + colW + gap);
  const maxH = Math.max(h1, h2);
  if (maxH > 0) y += maxH + 14;

  // --- Últimos pedidos ---
  doc.setTextColor(33, 33, 33);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold');
  doc.text('Últimos Pedidos', M, y);
  doc.autoTable({
    startY: y + 3,
    head: [['N° Pedido', 'Cliente', 'Vendedor', 'Temporada', 'Total', 'Estado', 'Fecha']],
    body: d.recent.length
      ? d.recent.map(o => [o.order_number, o.client, o.seller, o.season, fMoney(o.total, 'Gs'), o.status, o.date])
      : [[{ content: 'No hay pedidos aún.', colSpan: 7, styles: { halign: 'center', textColor: [120, 120, 120] } }]],
    headStyles: { fillColor: [155, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 248, 250] },
    columnStyles: { 4: { halign: 'right' } },
    styles: { cellPadding: 2.5, overflow: 'linebreak' },
    margin: { left: M, right: M }
  });

  doc.save(`dashboard-${new Date().toISOString().split('T')[0]}.pdf`);
}
