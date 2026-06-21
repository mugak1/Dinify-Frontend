import {
  buildCsv,
  buildReportFilename,
  buildXlsxData,
  fileCellValue,
  fileHeader,
} from './report-export';
import { ReportColumn, ReportDateRange } from '../models/reports.models';

// A representative listing-shaped column set covering every format.
const columns: ReportColumn[] = [
  { key: 'order_number', label: 'Order', format: 'text' },
  { key: 'time_created', label: 'Time', format: 'datetime' },
  { key: 'item_count', label: 'Items', format: 'number', align: 'right', total: true },
  { key: 'revenue', label: 'Net', format: 'ugx', align: 'right', total: true },
  { key: 'payment_status', label: 'Status', format: 'status' },
];

// Local (no-offset) datetimes keep the formatted output timezone-stable in CI.
const rows: Record<string, unknown>[] = [
  {
    order_number: 'ORD-1',
    time_created: '2026-06-01T09:30:00',
    item_count: 3,
    revenue: 15000,
    payment_status: 'paid',
  },
  {
    order_number: 'ORD-2',
    time_created: '2026-06-02T14:05:00',
    item_count: 1,
    revenue: 5000,
    payment_status: 'pending',
  },
];

const totals = { item_count: 4, revenue: 20000 };

const range: ReportDateRange = { preset: 'custom', from: '2026-06-01', to: '2026-06-21' };

describe('report-export', () => {
  describe('fileHeader', () => {
    it('appends " (UGX)" only to ugx columns', () => {
      expect(fileHeader({ key: 'r', label: 'Net', format: 'ugx' })).toBe('Net (UGX)');
      expect(fileHeader({ key: 'n', label: 'Items', format: 'number' })).toBe('Items');
      expect(fileHeader({ key: 't', label: 'Order', format: 'text' })).toBe('Order');
    });
  });

  describe('fileCellValue', () => {
    it('keeps ugx / number as raw numbers (no UGX, no separators), coercing blanks to 0', () => {
      expect(fileCellValue({ key: 'r', label: '', format: 'ugx' }, 15000)).toBe(15000);
      expect(fileCellValue({ key: 'n', label: '', format: 'number' }, 1234567)).toBe(1234567);
      expect(fileCellValue({ key: 'n', label: '', format: 'number' }, null)).toBe(0);
    });

    it('renders datetime as a clean "yyyy-MM-dd HH:mm" string', () => {
      expect(fileCellValue({ key: 't', label: '', format: 'datetime' }, '2026-06-01T09:30:00')).toBe(
        '2026-06-01 09:30',
      );
      expect(fileCellValue({ key: 't', label: '', format: 'datetime' }, '')).toBe('');
    });

    it('capitalizes status as its display label', () => {
      expect(fileCellValue({ key: 's', label: '', format: 'status' }, 'paid')).toBe('Paid');
    });
  });

  describe('buildCsv', () => {
    it('emits a header (with UGX unit), raw data rows and a totals row', () => {
      const lines = buildCsv(columns, rows, totals).split('\r\n');
      expect(lines[0]).toBe('Order,Time,Items,Net (UGX),Status');
      expect(lines[1]).toBe('ORD-1,2026-06-01 09:30,3,15000,Paid');
      expect(lines[2]).toBe('ORD-2,2026-06-02 14:05,1,5000,Pending');
      // Totals row mirrors the screen: "Total" in col 0, totalled columns filled, rest blank.
      expect(lines[3]).toBe('Total,,4,20000,');
      expect(lines.length).toBe(4);
    });

    it('quotes fields containing commas, quotes or newlines (RFC 4180)', () => {
      const cols: ReportColumn[] = [{ key: 'name', label: 'Name', format: 'text' }];
      const lines = buildCsv(
        cols,
        [{ name: 'Doe, Jane' }, { name: 'Quo"te' }, { name: 'a\nb' }],
        null,
      ).split('\r\n');
      expect(lines[0]).toBe('Name');
      expect(lines[1]).toBe('"Doe, Jane"');
      expect(lines[2]).toBe('"Quo""te"');
      expect(lines[3]).toBe('"a\nb"');
    });

    it('omits the totals row when there are no totals', () => {
      expect(buildCsv(columns, rows, null).split('\r\n').length).toBe(3);
    });

    it('omits the totals row when there are no rows', () => {
      expect(buildCsv(columns, [], totals)).toBe('Order,Time,Items,Net (UGX),Status');
    });
  });

  describe('buildXlsxData', () => {
    it('maps headers, cell types and values for write-excel-file', () => {
      const data = buildXlsxData(columns, rows, totals);

      // Bold String header row, with the UGX unit on the ugx column.
      expect(data[0].map((c) => c?.value)).toEqual(['Order', 'Time', 'Items', 'Net (UGX)', 'Status']);
      expect(data[0].every((c) => c?.type === String && c?.fontWeight === 'bold')).toBe(true);

      // Data row: numerics are raw Number cells; text/datetime/status are String cells.
      const r1 = data[1];
      expect(r1[0]).toEqual({ value: 'ORD-1', type: String });
      expect(r1[1]).toEqual({ value: '2026-06-01 09:30', type: String });
      expect(r1[2]).toEqual({ value: 3, type: Number });
      expect(r1[3]).toEqual({ value: 15000, type: Number });
      expect(r1[4]).toEqual({ value: 'Paid', type: String });
    });

    it('appends a bold totals row with raw numbers, "Total" in col 0 and null blanks', () => {
      const data = buildXlsxData(columns, rows, totals);
      const tr = data[data.length - 1];
      expect(tr[0]).toEqual({ value: 'Total', type: String, fontWeight: 'bold' });
      expect(tr[1]).toBeNull();
      expect(tr[2]).toEqual({ value: 4, type: Number, fontWeight: 'bold' });
      expect(tr[3]).toEqual({ value: 20000, type: Number, fontWeight: 'bold' });
      expect(tr[4]).toBeNull();
    });

    it('omits the totals row when there is nothing to total', () => {
      expect(buildXlsxData(columns, rows, null).length).toBe(rows.length + 1); // header + rows
      expect(buildXlsxData(columns, [], totals).length).toBe(1); // header only
    });
  });

  describe('buildReportFilename', () => {
    it('builds dinify-<slug>-<from>_<to>.<ext>, slugging the report title', () => {
      expect(buildReportFilename('Sales', range, 'csv')).toBe(
        'dinify-sales-2026-06-01_2026-06-21.csv',
      );
      expect(buildReportFilename('Menu performance', range, 'xlsx')).toBe(
        'dinify-menu-performance-2026-06-01_2026-06-21.xlsx',
      );
      expect(buildReportFilename('Transactions', range, 'csv')).toBe(
        'dinify-transactions-2026-06-01_2026-06-21.csv',
      );
      expect(buildReportFilename('Diners', range, 'xlsx')).toBe(
        'dinify-diners-2026-06-01_2026-06-21.xlsx',
      );
    });
  });
});
