import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportExportBarComponent } from './report-export-bar.component';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { ReportColumn, ReportDateRange } from '../../models/reports.models';

const columns: ReportColumn[] = [
  { key: 'order_number', label: 'Order', format: 'text' },
  { key: 'revenue', label: 'Net', format: 'ugx', align: 'right', total: true },
];
const rows = [{ order_number: 'ORD-1', revenue: 15000 }];
const totals = { revenue: 15000 };
const range: ReportDateRange = { preset: 'custom', from: '2026-06-01', to: '2026-06-21' };

describe('ReportExportBarComponent', () => {
  let fixture: ComponentFixture<ReportExportBarComponent>;
  let component: ReportExportBarComponent;

  const buttons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button[app-dn-button]'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportExportBarComponent],
      providers: [
        { provide: AuthenticationService, useValue: { currentRestaurant: { name: 'Test Bistro' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportExportBarComponent);
    component = fixture.componentInstance;
    component.columns = columns;
    component.rows = rows;
    component.totals = totals;
    component.reportTitle = 'Sales';
    component.range = range;
    fixture.detectChanges();
  });

  it('renders three export actions', () => {
    const labels = buttons().map((b) => b.textContent?.trim() ?? '');
    expect(buttons().length).toBe(3);
    expect(labels[0]).toContain('Export XLSX');
    expect(labels[1]).toContain('Export CSV');
    expect(labels[2]).toContain('Print');
  });

  it('enables all actions when ready', () => {
    expect(buttons().every((b) => !b.hasAttribute('disabled'))).toBe(true);
  });

  it('disables all actions and shows the reason tooltip when disabled', () => {
    component.disabled = true;
    component.disabledReason = 'Nothing to export for this range.';
    fixture.detectChanges();

    expect(buttons().every((b) => b.hasAttribute('disabled'))).toBe(true);

    const wrapper = fixture.nativeElement.querySelector('div') as HTMLElement;
    wrapper.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = document.body.querySelector('div.fixed.z-50');
    expect(tip?.textContent).toBe('Nothing to export for this range.');
    wrapper.dispatchEvent(new MouseEvent('mouseleave')); // remove the tooltip element
  });

  it('shows no tooltip while enabled', () => {
    const wrapper = fixture.nativeElement.querySelector('div') as HTMLElement;
    wrapper.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.body.querySelector('div.fixed.z-50')).toBeNull();
  });

  it('wires each button to its export action', () => {
    spyOn(component, 'onExportXlsx');
    spyOn(component, 'onExportCsv');
    spyOn(component, 'onPrint');

    const [xlsx, csv, print] = buttons();
    xlsx.click();
    csv.click();
    print.click();

    expect(component.onExportXlsx).toHaveBeenCalledTimes(1);
    expect(component.onExportCsv).toHaveBeenCalledTimes(1);
    expect(component.onPrint).toHaveBeenCalledTimes(1);
  });

  it('Export CSV downloads a .csv named for the report and range', () => {
    const realCreateElement = document.createElement.bind(document);
    const anchor = document.createElement('a');
    const clickSpy = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.callFake(
      ((tag: string) => (tag === 'a' ? anchor : realCreateElement(tag))) as typeof document.createElement,
    );
    spyOn(URL, 'createObjectURL').and.returnValue('blob:stub');
    spyOn(URL, 'revokeObjectURL');

    buttons()[1].click();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBe('dinify-sales-2026-06-01_2026-06-21.csv');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('Print opens a self-contained print window with the report + restaurant name', () => {
    const fakeDoc = { write: jasmine.createSpy('write'), close: jasmine.createSpy('close') };
    const openSpy = spyOn(window, 'open').and.returnValue({ document: fakeDoc } as unknown as Window);

    buttons()[2].click();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    const html = fakeDoc.write.calls.mostRecent().args[0] as string;
    expect(html).toContain('Sales');
    expect(html).toContain('Test Bistro');
  });

  it('does not act when disabled', () => {
    component.disabled = true;
    fixture.detectChanges();
    const openSpy = spyOn(window, 'open');
    component.onPrint(); // call directly — the guard should no-op
    expect(openSpy).not.toHaveBeenCalled();
  });
});
