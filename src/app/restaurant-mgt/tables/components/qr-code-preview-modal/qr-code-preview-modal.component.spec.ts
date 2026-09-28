import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import QRCode from 'qrcode';
import { QrCodePreviewModalComponent } from './qr-code-preview-modal.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { DiningArea, RestaurantTable } from '../../models/tables.models';

function table(over: Partial<RestaurantTable> = {}): RestaurantTable {
  return {
    id: 't1',
    number: 5,
    minCapacity: 2,
    maxCapacity: 4,
    shape: 'square',
    status: 'available',
    tags: [],
    isActive: true,
    hasQR: true,
    qrMode: 'order_pay',
    qrCredential: 'CRED-1',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...over,
  };
}

/** Drain a couple of microtask ticks so a resolved QRCode.toString settles. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('QrCodePreviewModalComponent', () => {
  let fixture: ComponentFixture<QrCodePreviewModalComponent>;
  let component: QrCodePreviewModalComponent;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    toast = jasmine.createSpyObj('ToastService', [
      'success', 'error', 'warning', 'info', 'clear',
    ]);
    await TestBed.configureTestingModule({
      imports: [QrCodePreviewModalComponent],
      providers: [{ provide: ToastService, useValue: toast }],
    }).compileComponents();
    fixture = TestBed.createComponent(QrCodePreviewModalComponent);
    component = fixture.componentInstance;
  });

  // Root-component @Inputs are not template-bound, so Angular never calls
  // ngOnChanges automatically — drive it explicitly.
  function openWithTable(t: RestaurantTable | null): void {
    component.open = true;
    component.table = t;
    component.ngOnChanges({
      open: new SimpleChange(false, true, true),
    });
  }

  function changeTable(t: RestaurantTable): void {
    const prev = component.table;
    component.table = t;
    component.ngOnChanges({
      table: new SimpleChange(prev, t, false),
    });
  }

  it('renders the QR from the credential URL when valid', async () => {
    const toStringSpy = spyOn(QRCode, 'toString').and.returnValue(
      Promise.resolve('<svg>ok</svg>') as unknown as void,
    );
    openWithTable(table({ id: 'abc', qrCredential: 'CRED-abc' }));
    await flush();

    expect(component.qrUrl).toBe(`${window.location.origin}/diner/h/abc?c=CRED-abc`);
    expect(toStringSpy).toHaveBeenCalled();
    expect(toStringSpy.calls.mostRecent().args[0]).toBe(component.qrUrl!);
    expect((component as any).rawSvg).toBe('<svg>ok</svg>');
  });

  it('does NOT invoke QR generation and shows the unavailable state when the credential is missing', () => {
    const toStringSpy = spyOn(QRCode, 'toString');
    openWithTable(table({ hasQR: true, qrCredential: '' }));

    expect(component.qrUrl).toBeNull();
    expect(toStringSpy).not.toHaveBeenCalled();

    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('QR credential unavailable');
  });

  it('does not render the credential URL as text, aria-label, title, or data attr', async () => {
    spyOn(QRCode, 'toString').and.returnValue(
      Promise.resolve('<svg>ok</svg>') as unknown as void,
    );
    openWithTable(table({ id: 'abc', qrCredential: 'CRED-SECRET' }));
    await flush();
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('CRED-SECRET');
    expect(html).not.toContain('/diner/h/abc?c=');
    // A neutral status stands in for the removed URL text.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Secure table link ready',
    );
  });

  it('emits regenerateRequested (never a service call) when Regenerate is pressed', () => {
    const emitted: RestaurantTable[] = [];
    component.regenerateRequested.subscribe(t => emitted.push(t));
    const t = table();
    component.table = t;
    component.onRegenerate();
    expect(emitted).toEqual([t]);
  });

  it('emits generateRequested for a table with no QR', () => {
    const emitted: RestaurantTable[] = [];
    component.generateRequested.subscribe(t => emitted.push(t));
    const t = table({ hasQR: false, qrCredential: undefined });
    component.table = t;
    component.onGenerate();
    expect(emitted).toEqual([t]);
  });

  it('rebuilds the QR from the NEW credential when the table input changes (post-rotation)', async () => {
    spyOn(QRCode, 'toString').and.callFake(
      ((url: string) => Promise.resolve(`svg:${url}`)) as any,
    );
    openWithTable(table({ id: 'abc', qrCredential: 'OLD' }));
    await flush();

    changeTable(table({ id: 'abc', qrCredential: 'NEW' }));
    await flush();

    expect(component.qrUrl).toBe(`${window.location.origin}/diner/h/abc?c=NEW`);
    expect((component as any).rawSvg).toBe(
      `svg:${window.location.origin}/diner/h/abc?c=NEW`,
    );
  });

  it('discards a stale async render so it cannot overwrite the newer QR', async () => {
    let resolveFirst!: (v: string) => void;
    let resolveSecond!: (v: string) => void;
    const first = new Promise<string>(res => (resolveFirst = res));
    const second = new Promise<string>(res => (resolveSecond = res));
    const spy = spyOn(QRCode, 'toString').and.returnValues(
      first as unknown as void,
      second as unknown as void,
    );

    openWithTable(table({ id: 'abc', qrCredential: 'OLD' })); // render #1 (token 1)
    changeTable(table({ id: 'abc', qrCredential: 'NEW' })); // render #2 (token 2)

    resolveSecond('svg:NEW');
    await flush();
    resolveFirst('svg:OLD'); // stale — must be ignored
    await flush();

    expect((component as any).rawSvg).toBe('svg:NEW');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shows the "old QR revoked" notice when recentlyRotated is set', () => {
    component.open = true;
    component.table = table();
    component.recentlyRotated = true;
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Old QR revoked');
  });

  /**
   * D14 B1 — the single-table print document carries the area name and table
   * number as TEXT. `handlePrint` writes into a same-origin popup, so the
   * document it actually wrote is parsed (DOMParser runs nothing) and asserted
   * on as DOM: a harmless marker element must stay literal text, with no
   * injected element or attribute. The locally generated QR SVG is trusted
   * markup and must still arrive as an element.
   */
  describe('handlePrint (dynamic labels are encoded as text)', () => {
    const MARKER = '<dinify-probe data-d14="x">m</dinify-probe>';
    let fakeDoc: { write: jasmine.Spy; close: jasmine.Spy };
    let openSpy: jasmine.Spy;

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

    beforeEach(() => {
      fakeDoc = {
        write: jasmine.createSpy('write'),
        close: jasmine.createSpy('close'),
      };
      openSpy = spyOn(window, 'open').and.returnValue(
        { document: fakeDoc } as unknown as Window,
      );
    });

    async function openPrintable(t: RestaurantTable, a?: DiningArea): Promise<void> {
      component.area = a;
      openWithTable(t);
      // A stubbed render settles in a microtask or two; the real `qrcode`
      // library takes longer, so wait (bounded) for the SVG to land.
      for (let i = 0; i < 200 && component.qrUrl && !(component as any).rawSvg; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      await flush();
    }

    function writtenDocument(): Document {
      expect(fakeDoc.write).toHaveBeenCalledTimes(1);
      const html = fakeDoc.write.calls.mostRecent().args[0] as string;
      return new DOMParser().parseFromString(html, 'text/html');
    }

    it('REGRESSION: an area name is literal text in the printed body', async () => {
      spyOn(QRCode, 'toString').and.returnValue(
        Promise.resolve('<svg class="qr"><path d="M0 0h1"/></svg>') as unknown as void,
      );
      await openPrintable(table({ number: 9 }), area(`Patio ${MARKER}`));

      component.handlePrint();

      const doc = writtenDocument();
      expect(doc.querySelector('dinify-probe')).toBeNull();
      expect(doc.querySelector('[data-d14]')).toBeNull();
      const label = doc.querySelector('.area-label')!;
      expect(label.textContent).toBe(`Patio ${MARKER}`);
      expect(label.children.length).toBe(0);
    });

    it('keeps the number-based title and label, and the trusted QR SVG as an element', async () => {
      spyOn(QRCode, 'toString').and.returnValue(
        Promise.resolve('<svg class="qr"><path d="M0 0h1"/></svg>') as unknown as void,
      );
      await openPrintable(table({ number: 9, displayName: 'Ignored here' }), area('Garden'));

      component.handlePrint();

      const doc = writtenDocument();
      // Single preview stays number-based; displayName is not introduced here.
      expect(doc.title).toBe('Table 9 QR Code');
      expect(doc.querySelector('.table-label')!.textContent).toBe('Table 9');
      expect(doc.querySelector('.area-label')!.textContent).toBe('Garden');
      const svg = doc.querySelector('.qr-container svg.qr');
      expect(svg).not.toBeNull();
      expect(svg!.querySelector('path')!.getAttribute('d')).toBe('M0 0h1');
      expect(fakeDoc.close).toHaveBeenCalled();
    });

    it('falls back to "Main Dining" when there is no area or its name is empty', async () => {
      spyOn(QRCode, 'toString').and.returnValue(
        Promise.resolve('<svg></svg>') as unknown as void,
      );
      await openPrintable(table(), undefined);
      component.handlePrint();
      expect(writtenDocument().querySelector('.area-label')!.textContent).toBe('Main Dining');

      fakeDoc.write.calls.reset();
      component.area = area('');
      component.handlePrint();
      expect(writtenDocument().querySelector('.area-label')!.textContent).toBe('Main Dining');
    });

    it('preserves Unicode, quotes, ampersands and entity-looking text as displayed text', async () => {
      const name = `Café "Ndiizi" & Friends' — &lt;b&gt; 🍌`;
      spyOn(QRCode, 'toString').and.returnValue(
        Promise.resolve('<svg></svg>') as unknown as void,
      );
      await openPrintable(table({ number: 3 }), area(name));

      component.handlePrint();

      expect(writtenDocument().querySelector('.area-label')!.textContent).toBe(name);
    });

    it('prints the real locally generated QR unchanged and leaves the credential URL untouched', async () => {
      await openPrintable(
        table({ id: 'abc', number: 2, qrCredential: 'CRED-<&>"' }),
        area(MARKER),
      );
      const url = `${window.location.origin}/diner/h/abc?c=${encodeURIComponent('CRED-<&>"')}`;
      expect(component.qrUrl).toBe(url);
      const rawSvg = (component as any).rawSvg as string;
      expect(rawSvg).toContain('<svg');

      component.handlePrint();

      const doc = writtenDocument();
      expect(doc.querySelector('dinify-probe')).toBeNull();
      const printed = doc.querySelector('.qr-container svg')!;
      const expected = new DOMParser()
        .parseFromString(rawSvg, 'text/html')
        .querySelector('svg')!;
      expect(printed.outerHTML).toBe(expected.outerHTML);
      expect(printed.querySelectorAll('path').length).toBeGreaterThan(0);
      expect(component.qrUrl).toBe(url);
    });

    it('writes nothing when the popup is blocked', async () => {
      spyOn(QRCode, 'toString').and.returnValue(
        Promise.resolve('<svg></svg>') as unknown as void,
      );
      await openPrintable(table(), area(MARKER));
      openSpy.and.returnValue(null);

      expect(() => component.handlePrint()).not.toThrow();
      expect(fakeDoc.write).not.toHaveBeenCalled();
    });

    it('opens no print window when the table has no usable credential', async () => {
      spyOn(QRCode, 'toString');
      await openPrintable(table({ qrCredential: '' }), area(MARKER));

      component.handlePrint();

      expect(openSpy).not.toHaveBeenCalled();
      expect(fakeDoc.write).not.toHaveBeenCalled();
    });
  });
});
