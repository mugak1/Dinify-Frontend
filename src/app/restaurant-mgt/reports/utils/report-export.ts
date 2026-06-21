// Pure, report-agnostic export helpers for the Reports module. They operate on
// the same generic ReportColumn[] + rows + totals the report-table renders, plus
// a report title (→ filename slug + headers) and the active date range, and
// produce a MACHINE-FRIENDLY file of the table:
//   - ugx / number cells → RAW numbers (no "UGX" in cells); the unit is appended
//     to ugx column HEADERS instead, so spreadsheet maths still works.
//   - datetime cells → a clean, parseable "yyyy-MM-dd HH:mm" string.
//   - text / status cells → the on-screen display string.
//   - a final totals row mirroring the on-screen footer (report-table).
// No backend, no custodial data. The pure builders carry no dependency on the
// xlsx library — it is dynamically imported only when an .xlsx is generated.

import { format as formatDate, parseISO } from 'date-fns';
import { ReportColumn, ReportDateRange } from '../models/reports.models';

export interface ReportExportContext {
  reportTitle: string;
  range: ReportDateRange;
}

/**
 * write-excel-file cell shape (its rows-of-cells data API). `null` represents a
 * blank cell. Kept local so the builders stay free of the library import.
 */
export interface XlsxCell {
  value: string | number;
  type: StringConstructor | NumberConstructor;
  fontWeight?: 'bold';
}
export type XlsxData = (XlsxCell | null)[][];

const UGX_HEADER_SUFFIX = ' (UGX)';
const DATETIME_FILE_FORMAT = 'yyyy-MM-dd HH:mm';

function isNumericFormat(col: ReportColumn): boolean {
  return col.format === 'ugx' || col.format === 'number';
}

/** Capitalize the first letter — mirrors report-table.statusLabel. */
function statusLabel(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** File column header: ugx columns get a "(UGX)" unit suffix. */
export function fileHeader(col: ReportColumn): string {
  return col.format === 'ugx' ? `${col.label}${UGX_HEADER_SUFFIX}` : col.label;
}

/**
 * Machine-friendly cell value for a file: a raw number for ugx/number (coerced
 * to 0 like the on-screen table), a clean "yyyy-MM-dd HH:mm" string for
 * datetime, the capitalized label for status, and the plain string otherwise.
 */
export function fileCellValue(col: ReportColumn, value: unknown): string | number {
  if (isNumericFormat(col)) return Number(value) || 0;
  if (col.format === 'datetime') {
    return value ? formatDate(parseISO(String(value)), DATETIME_FILE_FORMAT) : '';
  }
  if (col.format === 'status') return statusLabel(value);
  return value == null ? '' : String(value);
}

/**
 * Final totals row, mirroring the on-screen footer (report-table): a totalled
 * column shows its raw total; otherwise column 0 shows "Total" and the rest are
 * blank (''). Returns null when there is nothing to total (no totals, no rows).
 */
function totalsRowValues(
  columns: ReportColumn[],
  rowCount: number,
  totals: Record<string, number> | null,
): (string | number)[] | null {
  if (!totals || rowCount === 0) return null;
  return columns.map((col, i) => {
    if (col.total && totals[col.key] != null) return Number(totals[col.key]) || 0;
    return i === 0 ? 'Total' : '';
  });
}

// ── CSV (RFC 4180) ─────────────────────────────────────────
/** Quote a field only when it contains a comma, quote, CR or LF; escape " → "". */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  totals: Record<string, number> | null,
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvField(fileHeader(c))).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(fileCellValue(c, row[c.key]))).join(','));
  }
  const totalsRow = totalsRowValues(columns, rows.length, totals);
  if (totalsRow) lines.push(totalsRow.map((v) => csvField(v)).join(','));
  return lines.join('\r\n');
}

// ── XLSX (write-excel-file rows-of-cells data) ─────────────
export function buildXlsxData(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  totals: Record<string, number> | null,
): XlsxData {
  const header: XlsxData[number] = columns.map(
    (c): XlsxCell => ({ value: fileHeader(c), type: String, fontWeight: 'bold' }),
  );

  const body: XlsxData = rows.map((row) =>
    columns.map((col): XlsxCell => {
      const value = fileCellValue(col, row[col.key]);
      return isNumericFormat(col)
        ? { value: value as number, type: Number }
        : { value: value as string, type: String };
    }),
  );

  const data: XlsxData = [header, ...body];

  const totalsRow = totalsRowValues(columns, rows.length, totals);
  if (totalsRow) {
    data.push(
      columns.map((col, i): XlsxCell | null => {
        if (col.total && totals && totals[col.key] != null) {
          return { value: Number(totals[col.key]) || 0, type: Number, fontWeight: 'bold' };
        }
        return i === 0 ? { value: 'Total', type: String, fontWeight: 'bold' } : null;
      }),
    );
  }
  return data;
}

// ── Filenames ──────────────────────────────────────────────
/** "Menu performance" → "menu-performance"; "Sales" → "sales". */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildReportFilename(
  reportTitle: string,
  range: ReportDateRange,
  ext: 'csv' | 'xlsx',
): string {
  return `dinify-${slugify(reportTitle)}-${range.from}_${range.to}.${ext}`;
}

// ── Downloads (side-effecting) ─────────────────────────────
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  totals: Record<string, number> | null,
  ctx: ReportExportContext,
): void {
  const csv = buildCsv(columns, rows, totals);
  // Lead with a BOM (U+FEFF) so Excel reads the UTF-8 content correctly.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, buildReportFilename(ctx.reportTitle, ctx.range, 'csv'));
}

export async function exportXlsx(
  columns: ReportColumn[],
  rows: Record<string, unknown>[],
  totals: Record<string, number> | null,
  ctx: ReportExportContext,
): Promise<void> {
  // Dynamic import keeps write-excel-file out of the eager bundle and the pure
  // builders' tests; it loads on the first .xlsx export.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = buildXlsxData(columns, rows, totals);
  await writeXlsxFile(data, {
    columns: columns.map(() => ({ width: 22 })),
  }).toFile(buildReportFilename(ctx.reportTitle, ctx.range, 'xlsx'));
}
