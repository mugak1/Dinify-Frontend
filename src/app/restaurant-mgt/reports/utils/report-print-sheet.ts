// Print sheet for a report's primary table. Mirrors tables/utils/qr-print-sheet.ts:
// opens a new window, writes a self-contained HTML document (header + the FULL
// table rendered with ON-SCREEN formatting + the totals row) with an inline
// @media print block, and prints + closes on load. No external assets, no
// backend round-trip.

import { format as formatDate, parseISO } from 'date-fns';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { ReportColumn, ReportDateRange } from '../models/reports.models';

export interface ReportPrintContext {
  reportTitle: string;
  restaurantName: string;
  range: ReportDateRange;
}

/** Capitalize the first letter — mirrors report-table.statusLabel. */
function statusLabel(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** On-screen cell text — mirrors report-table.formatCell + statusLabel. */
function displayCell(col: ReportColumn, value: unknown): string {
  switch (col.format) {
    case 'number':
      return (Number(value) || 0).toLocaleString('en-UG');
    case 'ugx':
      return formatUGX(Number(value) || 0);
    case 'datetime':
      return value ? formatDate(parseISO(String(value)), 'd MMM yyyy, HH:mm') : '';
    case 'status':
      return statusLabel(value);
    default:
      return value == null ? '' : String(value);
  }
}

/** Numerics right-align — mirrors report-table.alignClass. */
function isRightAligned(col: ReportColumn): boolean {
  const align = col.align ?? (col.format === 'number' || col.format === 'ugx' ? 'right' : 'left');
  return align === 'right';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function printReport(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  totals: Record<string, number> | null,
  ctx: ReportPrintContext,
): void {
  // Open synchronously inside the click gesture so the browser doesn't block it.
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const cls = (col: ReportColumn) => (isRightAligned(col) ? ' class="num"' : '');

  const headCells = columns.map((c) => `<th${cls(c)}>${escapeHtml(c.label)}</th>`).join('');

  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => `<td${cls(c)}>${escapeHtml(displayCell(c, row[c.key]))}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  let totalsRow = '';
  if (totals && rows.length > 0) {
    totalsRow = `<tr class="totals">${columns
      .map((c, i) => {
        const text =
          c.total && totals[c.key] != null ? displayCell(c, totals[c.key]) : i === 0 ? 'Total' : '';
        return `<td${cls(c)}>${escapeHtml(text)}</td>`;
      })
      .join('')}</tr>`;
  }

  const rangeLabel = `${formatDate(parseISO(ctx.range.from), 'd MMM yyyy')} – ${formatDate(
    parseISO(ctx.range.to),
    'd MMM yyyy',
  )}`;
  const generated = new Date().toLocaleString();

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(ctx.reportTitle)} – ${escapeHtml(ctx.restaurantName)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111; }
        .header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e5e5e5; }
        .header h1 { font-size: 20px; font-weight: 700; }
        .header .resta { font-size: 13px; color: #444; margin-top: 2px; }
        .header .meta { font-size: 12px; color: #777; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { padding: 6px 10px; text-align: left; white-space: nowrap; border-bottom: 1px solid #e5e5e5; }
        th { font-weight: 600; color: #555; border-bottom: 2px solid #ccc; }
        td.num, th.num { text-align: right; }
        tr.totals td { font-weight: 700; border-top: 2px solid #999; border-bottom: none; }
        @media print {
          body { padding: 0; }
          th { color: #000; }
          tr { page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${escapeHtml(ctx.reportTitle)}</h1>
        <div class="resta">${escapeHtml(ctx.restaurantName)}</div>
        <div class="meta">${escapeHtml(rangeLabel)} &middot; Generated ${escapeHtml(generated)}</div>
      </div>
      <table>
        <thead><tr>${headCells}</tr></thead>
        <tbody>${bodyRows}${totalsRow}</tbody>
      </table>
      <script>window.onload = function () { window.print(); window.close(); };</script>
    </body>
    </html>
  `);
  printWindow.document.close();
}
