import QRCode from 'qrcode';
import { RestaurantTable, DiningArea } from '../models/tables.models';
import { environment } from 'src/environments/environment';

/**
 * Opens a print-ready page with QR codes for all tables in an area,
 * laid out in a 3-column grid suitable for cutting and placing on tables.
 *
 * QR codes are generated locally with the bundled `qrcode` library (the same
 * one the single-QR preview uses) instead of the external api.qrserver.com
 * service, so printing needs no third-party round-trip and leaks no table URLs.
 */
export async function generateQRPrintSheet(
  areaTables: RestaurantTable[],
  area: DiningArea,
): Promise<{ printed: number; skipped: number; opened: boolean }> {
  const baseUrl = environment.dinerBaseUrl || window.location.origin;

  // Only QR-enabled tables with a valid (non-empty) credential are printable. A
  // table flagged hasQR but missing its credential is SKIPPED and reported to the
  // caller — never silently dropped, and never printed as an invalid `?c=` QR.
  const withQr = areaTables.filter(t => t.hasQR);
  const printable = withQr
    .map(table => ({ table, url: buildDinerQRUrl(baseUrl, table) }))
    .filter(
      (entry): entry is { table: RestaurantTable; url: string } =>
        entry.url !== null,
    )
    .sort((a, b) => a.table.number - b.table.number);
  const skipped = withQr.length - printable.length;

  if (printable.length === 0) {
    return { printed: 0, skipped, opened: false };
  }

  // Open the print window synchronously, inside the click gesture, so the
  // browser doesn't block the popup; fill it once the QR data URLs are ready.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return { printed: printable.length, skipped, opened: false };
  }

  const tableCards = (
    await Promise.all(
      printable.map(async ({ table, url }) => {
        const qrImageUrl = await QRCode.toDataURL(url, {
          width: 400,
          margin: 2,
          errorCorrectionLevel: 'H',
          color: { dark: '#000000', light: '#ffffff' },
        });

        return `
        <div class="card">
          <div class="table-number">Table ${table.displayName || table.number}</div>
          <div class="area-name">${area.name}</div>
          <img src="${qrImageUrl}" alt="QR code for table ${table.number}" width="180" height="180" />
          <div class="seats">${table.maxCapacity} seats &middot; ${table.shape}</div>
          <div class="scan-label">Scan to view menu &amp; order</div>
        </div>
      `;
      }),
    )
  ).join('');

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
        <p>${printable.length} tables &middot; Generated ${new Date().toLocaleDateString()}</p>
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
  return { printed: printable.length, skipped, opened: true };
}

/**
 * Builds the diner-facing QR URL for a table, or returns `null` when the table
 * has no usable credential — FAIL CLOSED. The QR encodes the opaque, signed
 * credential (backend PR 7A) as `?c=`; the diner app reads it, then exchanges it
 * at the protected scan endpoint for a short-lived table session. The `:table`
 * path segment is retained only so the existing `/diner/h/:table` route matches;
 * it is a display hint, NOT authority (the backend derives the table from the
 * credential, which encodes it).
 *
 * Returning `null` (rather than the old `?c=` empty fallback) guarantees no
 * caller can ever render, copy, download, open or print a credential-less QR.
 */
function buildDinerQRUrl(
  baseUrl: string,
  table: RestaurantTable,
): string | null {
  const credential = table.qrCredential;
  if (!table.id || typeof credential !== 'string' || credential.trim() === '') {
    return null;
  }
  return `${baseUrl}/diner/h/${table.id}?c=${encodeURIComponent(credential)}`;
}

/**
 * Returns the diner-facing URL for a table's QR code, or `null` when the table
 * has no usable credential (see `buildDinerQRUrl`). Callers MUST treat `null` as
 * "no QR" and refuse to render/copy/download/open/print.
 */
export function getTableQRUrl(table: RestaurantTable): string | null {
  const baseUrl = environment.dinerBaseUrl || window.location.origin;
  return buildDinerQRUrl(baseUrl, table);
}
