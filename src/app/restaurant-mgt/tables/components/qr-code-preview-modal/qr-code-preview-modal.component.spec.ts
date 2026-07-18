import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import QRCode from 'qrcode';
import { QrCodePreviewModalComponent } from './qr-code-preview-modal.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { RestaurantTable } from '../../models/tables.models';

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
});
