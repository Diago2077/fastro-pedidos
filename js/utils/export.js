// ============================================================
// EXPORTACIÓN PDF y EXCEL
// ============================================================

export function exportPDF(docTitle, columns, rows, filename = 'reporte.pdf') {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();

  // Cabecera
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('FASTRO S.A.', 14, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(docTitle, 14, 17);
  doc.text(`Generado: ${new Date().toLocaleDateString('es-PY')}`, pageW - 14, 17, { align: 'right' });

  doc.autoTable({
    startY: 27,
    head: [columns.map(c => c.header)],
    body: rows.map(row => columns.map(c => {
      const v = row[c.key];
      return c.format ? c.format(v, row) : (v ?? '');
    })),
    headStyles: { fillColor: [155, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 248, 250] },
    styles: { cellPadding: 3, overflow: 'linebreak' },
    margin: { top: 27, left: 10, right: 10 }
  });

  doc.save(filename);
}

export function exportExcel(sheetTitle, columns, rows, filename = 'reporte.xlsx') {
  const header = columns.map(c => c.header);
  const data = rows.map(row => columns.map(c => {
    const v = row[c.key];
    return c.format ? c.format(v, row) : (v ?? '');
  }));

  const ws = window.XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = columns.map(c => ({ wch: Math.max((c.header || '').length + 4, c.width || 15) }));

  // Estilo básico de cabecera (color no soportado en free tier, solo negrita)
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetTitle.substring(0, 31));
  window.XLSX.writeFile(wb, filename);
}
