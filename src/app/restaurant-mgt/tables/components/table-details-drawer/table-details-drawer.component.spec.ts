import { TestBed } from '@angular/core/testing';
import { TableDetailsDrawerComponent } from './table-details-drawer.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import {
  DiningArea,
  RestaurantTable,
  SeatedParty,
} from '../../models/tables.models';

/**
 * D14 B1 — the bill print document carries table, area and order-item labels
 * as TEXT.
 *
 * This drawer belongs to the PARKED Service View, which is not mounted in the
 * shipped UI (`TablesComponent` forces the setup view and the Service View data
 * sits behind `USE_MOCK_SERVICE`). Nothing here mounts it or changes a flag:
 * `handlePrintBill` is exercised as a component method, so this is source-level
 * reachability of the same print-document class as the QR sheets, repaired
 * before it can ship un-encoded.
 *
 * The document the method actually wrote is parsed (DOMParser runs nothing)
 * and asserted on as DOM rather than as substrings.
 */
describe('TableDetailsDrawerComponent — handlePrintBill (labels encoded as text)', () => {
  const MARKER = '<dinify-probe data-d14="x">m</dinify-probe>';
  const TITLE_BREAK = '</title><dinify-probe data-d14="t"></dinify-probe>';

  let component: TableDetailsDrawerComponent;
  let fakeDoc: { write: jasmine.Spy; close: jasmine.Spy };
  let openSpy: jasmine.Spy;

  function table(over: Partial<RestaurantTable> = {}): RestaurantTable {
    return {
      id: 't1',
      number: 5,
      areaId: 'area-1',
      minCapacity: 2,
      maxCapacity: 4,
      shape: 'square',
      status: 'seated',
      tags: [],
      isActive: true,
      hasQR: true,
      qrMode: 'order_only',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      ...over,
    };
  }

  function area(name: string): DiningArea {
    return {
      id: 'area-1',
      name,
      isIndoor: true,
      smokingAllowed: false,
      accessible: true,
      isActive: true,
      tableIds: ['t1'],
    };
  }

  function party(over: Partial<SeatedParty> = {}): SeatedParty {
    return {
      id: 'p1',
      tableId: 't1',
      partySize: 3,
      adults: 3,
      children: 0,
      seatedAt: new Date(),
      serverId: 's1',
      currentCheck: 45000,
      isPaid: false,
      orderItems: [
        { id: 'i1', name: 'Rolex', quantity: 2, status: 'served' },
      ],
      ...over,
    };
  }

  function arrange(t: RestaurantTable, a: DiningArea, p: SeatedParty): void {
    component.tables = [t];
    component.areas = [a];
    component.seatedParties = [p];
    component.tableId = t.id;
  }

  function writtenDocument(): Document {
    expect(fakeDoc.write).toHaveBeenCalledTimes(1);
    const html = fakeDoc.write.calls.mostRecent().args[0] as string;
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function noInjectedMarkup(doc: Document): void {
    expect(doc.querySelector('dinify-probe')).toBeNull();
    expect(doc.querySelector('[data-d14]')).toBeNull();
  }

  beforeEach(async () => {
    const toast = jasmine.createSpyObj('ToastService', [
      'success', 'error', 'warning', 'info', 'clear',
    ]);
    await TestBed.configureTestingModule({
      imports: [TableDetailsDrawerComponent],
      providers: [{ provide: ToastService, useValue: toast }],
    }).compileComponents();
    component = TestBed.createComponent(TableDetailsDrawerComponent).componentInstance;

    fakeDoc = {
      write: jasmine.createSpy('write'),
      close: jasmine.createSpy('close'),
    };
    openSpy = spyOn(window, 'open').and.returnValue(
      { document: fakeDoc } as unknown as Window,
    );
  });

  it('REGRESSION: a table display name is literal text in the title and heading', () => {
    arrange(table({ displayName: `Booth ${TITLE_BREAK}` }), area('Main'), party());

    component.handlePrintBill();

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    expect(doc.title).toBe(`Bill – Booth ${TITLE_BREAK}`);
    expect(doc.head.querySelectorAll('title').length).toBe(1);
    expect(doc.querySelector('h2')!.textContent).toBe(`Booth ${TITLE_BREAK}`);
  });

  it('REGRESSION: an area name is literal text in the sub-heading', () => {
    arrange(table(), area(`Patio ${MARKER}`), party({ partySize: 4 }));

    component.handlePrintBill();

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    const sub = doc.querySelector('.sub')!;
    expect(sub.textContent).toBe(`Patio ${MARKER} · Party of 4`);
    expect(sub.children.length).toBe(0);
  });

  it('REGRESSION: order-item names and statuses are literal text in their rows', () => {
    arrange(
      table(),
      area('Main'),
      party({
        orderItems: [
          { id: 'i1', name: `Chips ${MARKER}`, quantity: 2, status: 'served' },
          { id: 'i2', name: 'Tea & "Mandazi"', quantity: 1, status: `ready${MARKER}` as any },
        ],
      }),
    );

    component.handlePrintBill();

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    const rows = Array.from(doc.querySelectorAll('table')[0].querySelectorAll('tr'));
    expect(rows.length).toBe(2);
    expect(rows.map(r => Array.from(r.querySelectorAll('td')).map(td => td.textContent))).toEqual([
      [`2× Chips ${MARKER}`, 'served'],
      ['1× Tea & "Mandazi"', `ready${MARKER}`],
    ]);
  });

  it('keeps the ordinary bill: number fallback name, party size, formatted total', () => {
    arrange(table({ number: 12, displayName: undefined }), area('Garden Café 🌿'), party());

    component.handlePrintBill();

    const doc = writtenDocument();
    expect(doc.title).toBe('Bill – Table 12');
    expect(doc.querySelector('h2')!.textContent).toBe('Table 12');
    expect(doc.querySelector('.sub')!.textContent).toBe('Garden Café 🌿 · Party of 3');
    const total = doc.querySelector('tr.total')!;
    expect(total.textContent).toContain('TOTAL');
    expect(total.textContent).toContain(`UGX ${(45000).toLocaleString()}`);
    expect(fakeDoc.close).toHaveBeenCalled();
  });

  it('renders an empty sub-heading area when the table has no area (existing ?? fallback)', () => {
    component.tables = [table({ areaId: undefined })];
    component.areas = [area('Unused')];
    component.seatedParties = [party()];
    component.tableId = 't1';

    component.handlePrintBill();

    expect(writtenDocument().querySelector('.sub')!.textContent).toBe(' · Party of 3');
  });

  it('writes nothing when the popup is blocked', () => {
    arrange(table(), area(MARKER), party());
    openSpy.and.returnValue(null);

    expect(() => component.handlePrintBill()).not.toThrow();
    expect(fakeDoc.write).not.toHaveBeenCalled();
  });

  it('opens no window when no party is seated', () => {
    component.tables = [table()];
    component.areas = [area('Main')];
    component.seatedParties = [];
    component.tableId = 't1';

    component.handlePrintBill();

    expect(openSpy).not.toHaveBeenCalled();
  });
});
