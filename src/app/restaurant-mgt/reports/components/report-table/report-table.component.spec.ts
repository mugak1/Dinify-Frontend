import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportTableComponent } from './report-table.component';
import { ReportColumn } from '../../models/reports.models';

const COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Name', format: 'text' },
  { key: 'count', label: 'Count', format: 'number', align: 'right', total: true },
  { key: 'amount', label: 'Amount', format: 'ugx', align: 'right', total: true },
  { key: 'status', label: 'Status', format: 'status' },
];

describe('ReportTableComponent', () => {
  let component: ReportTableComponent;
  let fixture: ComponentFixture<ReportTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportTableComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportTableComponent);
    component = fixture.componentInstance;
    component.columns = COLUMNS;
  });

  function render(rows: any[], totals: Record<string, number> | null = null) {
    component.rows = rows;
    component.totals = totals;
    component.ngOnChanges();
    fixture.detectChanges();
  }

  it('formats number, UGX, datetime and status cells', () => {
    render([{ name: 'Pilau', count: 1500, amount: 12000, status: 'paid' }]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('1,500');
    expect(text).toContain('UGX 12,000');

    const badge = fixture.nativeElement.querySelector('app-dn-badge');
    expect(badge.textContent.trim()).toBe('Paid');
    expect(badge.className).toContain('bg-success'); // paid → success variant

    expect(component.formatCell('2026-06-21T09:05:00', 'datetime')).toContain('2026');
  });

  it('right-aligns numeric columns', () => {
    render([{ name: 'a', count: 1, amount: 1, status: 'paid' }]);
    const headers = fixture.nativeElement.querySelectorAll('th');
    expect(headers[1].className).toContain('text-right'); // count
    expect(headers[2].className).toContain('text-right'); // amount
    expect(headers[0].className).toContain('text-left'); // name
  });

  it('sorts ascending then descending on header click', () => {
    render([{ name: 'a', count: 3 }, { name: 'b', count: 1 }, { name: 'c', count: 2 }]);
    component.onSort(COLUMNS[1]); // count asc
    expect(component.sortedRows.map((r) => r.count)).toEqual([1, 2, 3]);
    component.onSort(COLUMNS[1]); // count desc
    expect(component.sortedRows.map((r) => r.count)).toEqual([3, 2, 1]);
  });

  it('renders a totals footer only when totals are supplied', () => {
    render([{ name: 'a', count: 2, amount: 100, status: 'paid' }]);
    expect(fixture.nativeElement.querySelector('tfoot')).toBeNull();

    render([{ name: 'a', count: 2, amount: 100, status: 'paid' }], { count: 2, amount: 100 });
    const tfoot = fixture.nativeElement.querySelector('tfoot');
    expect(tfoot).not.toBeNull();
    expect(tfoot.textContent).toContain('Total');
    expect(tfoot.textContent).toContain('UGX 100');
  });

  it('shows the empty label when there are no rows', () => {
    component.emptyLabel = 'Nothing here';
    render([]);
    expect(fixture.nativeElement.textContent).toContain('Nothing here');
    expect(fixture.nativeElement.querySelector('tbody tr td').getAttribute('colspan')).toBe('4');
  });

  it('maps the transaction-status tokens to badge variants', () => {
    // New transaction tokens
    expect(component.statusVariant('success')).toBe('success');
    expect(component.statusVariant('initiated')).toBe('secondary');
    // Existing sales tokens still hold
    expect(component.statusVariant('paid')).toBe('success');
    expect(component.statusVariant('pending')).toBe('warning');
    expect(component.statusVariant('failed')).toBe('destructive');
    expect(component.statusVariant('refunded')).toBe('secondary');
    // Labels capitalize the lowercase tokens
    expect(component.statusLabel('success')).toBe('Success');
    expect(component.statusLabel('initiated')).toBe('Initiated');
  });
});
