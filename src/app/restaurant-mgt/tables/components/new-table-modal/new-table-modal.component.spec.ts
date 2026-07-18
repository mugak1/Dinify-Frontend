import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { NewTableModalComponent } from './new-table-modal.component';
import { RestaurantTable } from '../../models/tables.models';

/**
 * The generic table editor must NEVER masquerade as QR activation or revocation:
 *  - create may honestly activate an initial QR (has_qr), but never writes a
 *    client rotation timestamp;
 *  - edit re-sends neither has_qr nor qr_regenerated_at, so saving an existing
 *    table can't silently flip or "revoke" its QR. qr_mode stays editable.
 */
describe('NewTableModalComponent — honest QR editing', () => {
  let component: NewTableModalComponent;

  beforeEach(() => {
    component = new NewTableModalComponent();
  });

  function capture(): Partial<RestaurantTable> {
    let emitted!: Partial<RestaurantTable>;
    component.saved.subscribe(v => (emitted = v));
    component.onSubmit();
    return emitted;
  }

  it('create + Generate QR emits hasQR:true and qrMode but NO client timestamp', () => {
    component.table = null;
    component.number = 7;
    component.maxCapacity = 4;
    component.generateQR = true;
    component.qrMode = 'order_pay';

    const e = capture();

    expect(e.hasQR).toBeTrue();
    expect(e.qrMode).toBe('order_pay');
    expect('qrRegeneratedAt' in e).toBeFalse();
  });

  it('create without QR emits hasQR:false and no qrMode', () => {
    component.table = null;
    component.number = 7;
    component.maxCapacity = 4;
    component.generateQR = false;

    const e = capture();

    expect(e.hasQR).toBeFalse();
    expect(e.qrMode).toBeUndefined();
    expect('qrRegeneratedAt' in e).toBeFalse();
  });

  it('editing an existing active table emits NEITHER hasQR NOR qrRegeneratedAt', () => {
    component.table = { id: 't1', number: 5, hasQR: true, qrMode: 'order_pay' } as any;
    component.number = 5;
    component.maxCapacity = 4;
    component.qrMode = 'menu_only';

    const e = capture();

    expect('hasQR' in e).toBeFalse();
    expect('qrRegeneratedAt' in e).toBeFalse();
    expect(e.qrMode).toBe('menu_only'); // qr_mode stays an ordinary editable setting
  });

  it('editing a table without a QR emits no hasQR, no qrMode, no timestamp', () => {
    component.table = { id: 't1', number: 5, hasQR: false } as any;
    component.number = 5;
    component.maxCapacity = 4;

    const e = capture();

    expect('hasQR' in e).toBeFalse();
    expect(e.qrMode).toBeUndefined();
    expect('qrRegeneratedAt' in e).toBeFalse();
  });
});

describe('NewTableModalComponent — edit-mode template', () => {
  it('hides the "Generate QR code on save" toggle and shows a read-only status in edit mode', () => {
    TestBed.configureTestingModule({ imports: [NewTableModalComponent] });
    const fixture = TestBed.createComponent(NewTableModalComponent);
    const comp = fixture.componentInstance;

    comp.open = true;
    comp.table = {
      id: 't1', number: 5, hasQR: true, qrMode: 'order_pay',
      tags: [], minCapacity: 2, maxCapacity: 4, shape: 'square', isActive: true,
    } as any;
    comp.ngOnChanges({ open: new SimpleChange(false, true, true) });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Generate QR code on save');
    expect(text).toContain('QR active');
  });

  it('shows the "Generate QR code on save" toggle when creating a new table', () => {
    TestBed.configureTestingModule({ imports: [NewTableModalComponent] });
    const fixture = TestBed.createComponent(NewTableModalComponent);
    const comp = fixture.componentInstance;

    comp.open = true;
    comp.table = null;
    comp.ngOnChanges({ open: new SimpleChange(false, true, true) });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Generate QR code on save');
  });
});
