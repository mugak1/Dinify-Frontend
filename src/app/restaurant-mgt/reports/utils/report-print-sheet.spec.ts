import { printReport } from './report-print-sheet';
import { ReportColumn } from '../models/reports.models';
import { formatUGX } from '../../../_shared/utils/price-utils';

/**
 * A stand-in print popup. HTML's document-open steps erase every event listener
 * on the document and its window, so this fake's `document.open()` erases the
 * load listener too: a lifecycle that listens before it opens never prints,
 * here as in a real frame (`print-document.spec.ts` proves the real one).
 */
function fakePrintWindow() {
  let listeners: { type: string; fn: () => void }[] = [];
  const document = {
    open: jasmine.createSpy('open').and.callFake(() => {
      listeners = [];
    }),
    write: jasmine.createSpy('write'),
    close: jasmine.createSpy('close'),
  };
  return {
    document,
    closed: false,
    addEventListener: jasmine
      .createSpy('addEventListener')
      .and.callFake((type: string, fn: () => void) => listeners.push({ type, fn })),
    print: jasmine.createSpy('print'),
    close: jasmine.createSpy('windowClose'),
    /** Fire the popup's `load` event, as the browser does once it has loaded. */
    fireLoad(): void {
      listeners.filter(l => l.type === 'load').forEach(l => l.fn());
    },
  };
}
type FakePrintWindow = ReturnType<typeof fakePrintWindow>;

/** Script elements plus inline `on*` handlers: neither runs under `script-src 'self'`. */
function scriptsIn(doc: Document): number {
  const handlers = Array.from(doc.querySelectorAll('*')).filter(el =>
    Array.from(el.attributes).some(a => a.name.toLowerCase().startsWith('on')),
  );
  return doc.querySelectorAll('script').length + handlers.length;
}

/**
 * The report print sheet already HTML-encoded every dynamic value before D14
 * B1; its private encoder was only moved to `_shared/utils/escape-html.ts` so
 * the table print documents could reuse it. These tests are the POSITIVE
 * CONTROL for that move: the document `printReport` actually writes is parsed
 * (DOMParser runs nothing) and must keep rendering headings and cells as text,
 * with the same formatting, after the extraction.
 */
describe('printReport (dynamic values are encoded as text)', () => {
  const MARKER = '<dinify-probe data-d14="x">m</dinify-probe>';
  const TITLE_BREAK = '</title><dinify-probe data-d14="t"></dinify-probe>';

  const columns: ReportColumn[] = [
    { key: 'item', label: 'Item' },
    { key: 'qty', label: 'Qty', format: 'number', total: true },
    { key: 'revenue', label: 'Revenue', format: 'ugx', total: true },
    { key: 'status', label: 'Status', format: 'status' },
  ];

  const range = { preset: 'custom' as const, from: '2026-07-01', to: '2026-07-31' };

  let fakeWin: FakePrintWindow;
  let fakeDoc: FakePrintWindow['document'];
  let openSpy: jasmine.Spy;

  beforeEach(() => {
    fakeWin = fakePrintWindow();
    fakeDoc = fakeWin.document;
    openSpy = spyOn(window, 'open').and.returnValue(fakeWin as unknown as Window);
  });

  function writtenDocument(): Document {
    expect(fakeDoc.write).toHaveBeenCalledTimes(1);
    const html = fakeDoc.write.calls.mostRecent().args[0] as string;
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function noInjectedMarkup(doc: Document): void {
    expect(doc.querySelector('dinify-probe')).toBeNull();
    expect(doc.querySelector('[data-d14]')).toBeNull();
  }

  it('CONTROL: restaurant name and title stay literal text, including title-closing content', () => {
    printReport(columns, [], null, {
      reportTitle: `Sales ${MARKER}`,
      restaurantName: `Cafe ${TITLE_BREAK}`,
      range,
    });

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    expect(doc.title).toBe(`Sales ${MARKER} – Cafe ${TITLE_BREAK}`);
    expect(doc.head.querySelectorAll('title').length).toBe(1);
    expect(doc.querySelector('.header h1')!.textContent).toBe(`Sales ${MARKER}`);
    expect(doc.querySelector('.resta')!.textContent).toBe(`Cafe ${TITLE_BREAK}`);
  });

  it('CONTROL: column labels and text cells stay literal text', () => {
    printReport(
      [{ key: 'item', label: `Item ${MARKER}` }, ...columns.slice(1)],
      [{ item: `Chips ${MARKER}`, qty: 2, revenue: 7000, status: 'paid' }],
      null,
      { reportTitle: 'Sales', restaurantName: 'Cafe', range },
    );

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    expect(doc.querySelector('thead th')!.textContent).toBe(`Item ${MARKER}`);
    expect(doc.querySelector('tbody td')!.textContent).toBe(`Chips ${MARKER}`);
  });

  it('keeps ordinary headings, formatted cells, alignment and the totals row', () => {
    printReport(
      columns,
      [
        { item: 'Café "Ndiizi" & Friends', qty: 1200, revenue: 150000, status: 'paid' },
        { item: 'Tea &amp; 🍌', qty: 3, revenue: 4500, status: null },
      ],
      { qty: 1203, revenue: 154500 },
      { reportTitle: 'Menu performance', restaurantName: 'Café Ndiizi', range },
    );

    const doc = writtenDocument();
    expect(doc.title).toBe('Menu performance – Café Ndiizi');
    expect(Array.from(doc.querySelectorAll('thead th')).map(th => th.textContent)).toEqual([
      'Item', 'Qty', 'Revenue', 'Status',
    ]);
    expect(Array.from(doc.querySelectorAll('thead th')).map(th => th.className)).toEqual([
      '', 'num', 'num', '',
    ]);
    const bodyRows = Array.from(doc.querySelectorAll('tbody tr'));
    expect(bodyRows.length).toBe(3);
    const cells = (tr: Element) => Array.from(tr.querySelectorAll('td')).map(td => td.textContent);
    expect(cells(bodyRows[0])).toEqual([
      'Café "Ndiizi" & Friends',
      (1200).toLocaleString('en-UG'),
      formatUGX(150000),
      'Paid',
    ]);
    expect(cells(bodyRows[1])).toEqual(['Tea &amp; 🍌', '3', formatUGX(4500), '']);
    expect(bodyRows[2].className).toBe('totals');
    expect(cells(bodyRows[2])).toEqual([
      'Total', (1203).toLocaleString('en-UG'), formatUGX(154500), '',
    ]);
    expect(doc.querySelector('.meta')!.textContent).toContain('1 Jul 2026 – 31 Jul 2026');
    expect(fakeDoc.close).toHaveBeenCalled();
  });

  it('writes no script, and prints then closes the popup only once it has loaded', () => {
    printReport(columns, [{ item: 'Tea', qty: 1, revenue: 100, status: 'paid' }], null, {
      reportTitle: 'Sales',
      restaurantName: 'Café',
      range,
    });

    expect(scriptsIn(writtenDocument())).toBe(0);
    expect(fakeDoc.open).toHaveBeenCalledBefore(fakeDoc.write);
    expect(fakeWin.print).not.toHaveBeenCalled();
    expect(fakeWin.close).not.toHaveBeenCalled();

    fakeWin.fireLoad();

    expect(fakeWin.print).toHaveBeenCalledTimes(1);
    expect(fakeWin.close).toHaveBeenCalledTimes(1);
    expect(fakeWin.print).toHaveBeenCalledBefore(fakeWin.close);
  });

  it('writes nothing when the popup is blocked', () => {
    openSpy.and.returnValue(null);

    expect(() =>
      printReport(columns, [], null, { reportTitle: 'Sales', restaurantName: MARKER, range }),
    ).not.toThrow();
    expect(fakeDoc.write).not.toHaveBeenCalled();
    expect(fakeWin.print).not.toHaveBeenCalled();
  });
});
