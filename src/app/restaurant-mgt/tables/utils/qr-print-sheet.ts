import { RestaurantTable, DiningArea } from '../models/tables.models';

/**
 * Opens a print-ready page with QR codes for all tables in an area,
 * laid out in a 3-column grid suitable for cutting and placing on tables.
 */
export function generateQRPrintSheet(
  areaTables: RestaurantTable[],
  area: DiningArea,
): void {
  const baseUrl = window.location.origin;

  const tableCards = areaTables
    .filter(t => t.hasQR)
    .sort((a, b) => a.number - b.number)
    .map(table => {
      const qrMode = table.qrMode || 'order_pay';
      const qrUrl = `${baseUrl}/diner/h/${table.id}?mode=${qrMode}`;
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}&margin=8`;

      return `
        <div class="card">
          <div class="table-number">Table ${table.displayName || table.number}</div>
          <div class="area-name">${area.name}</div>
          <img src="${qrImageUrl}" alt="QR code for table ${table.number}" width="180" height="180" />
          <div class="seats">${table.maxCapacity} seats &middot; ${table.shape}</div>
          <div class="scan-label">Scan to view menu &amp; order</div>
        </div>
      `;
    })
    .join('');

  if (!tableCards) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR Codes – ${area.name}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: system-ui, -apple-system, sans-serif;
          padding: 24px;
          background: #fff;
          color: #111;
        }
        .header {
          text-align: center;
          margin-bottom: 32px;
          padding-bottom: 16px;
          border-bottom: 2px solid #e5e5e5;
        }
        .header h1 { font-size: 24px; font-weight: 700; }
        .header p { font-size: 13px; color: #666; margin-top: 4px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }
        .card {
          border: 2px dashed #ccc;
          border-radius: 16px;
          padding: 24px 16px;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .table-number {
          font-size: 22px;
          font-weight: 800;
          margin-bottom: 2px;
        }
        .area-name {
          font-size: 12px;
          color: #888;
          margin-bottom: 16px;
        }
        .card img {
          display: block;
          margin: 0 auto 12px;
        }
        .seats {
          font-size: 11px;
          color: #888;
          margin-bottom: 4px;
        }
        .scan-label {
          font-size: 13px;
          color: #444;
          font-weight: 500;
        }
        @media print {
          body { padding: 0; }
          .header { margin-bottom: 20px; }
          .grid { gap: 16px; }
          .card { border-color: #999; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${area.name} – QR Codes</h1>
        <p>${areaTables.filter(t => t.hasQR).length} tables &middot; Generated ${new Date().toLocaleDateString()}</p>
      </div>
      <div class="grid">
        ${tableCards}
      </div>
      <script>
        Promise.all(
          Array.from(document.images).map(img =>
            img.complete
              ? Promise.resolve()
              : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })
          )
        ).then(() => {
          window.print();
        });
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

/**
 * Returns the diner-facing URL for a table's QR code.
 */
export function getTableQRUrl(table: RestaurantTable): string {
  const baseUrl = window.location.origin;
  const qrMode = table.qrMode || 'order_pay';
  return `${baseUrl}/diner/h/${table.id}?mode=${qrMode}`;
}
