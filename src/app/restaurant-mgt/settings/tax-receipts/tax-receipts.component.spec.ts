import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { TaxReceiptsComponent } from './tax-receipts.component';
import { RestaurantTaxReceiptsService } from 'src/app/_services/restaurant-tax-receipts.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { RestaurantDetail } from 'src/app/_models/app.models';

function makeDetail(overrides: Partial<RestaurantDetail> = {}): RestaurantDetail {
  return {
    id: 'r1',
    vat_registered: true,
    vat_rate: '18.00',
    tin: '1000123456',
    receipt_footer: 'Thanks for dining with us!',
    ...overrides,
  } as RestaurantDetail;
}

describe('TaxReceiptsComponent', () => {
  let component: TaxReceiptsComponent;
  let fixture: ComponentFixture<TaxReceiptsComponent>;
  let svc: jasmine.SpyObj<RestaurantTaxReceiptsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    svc = jasmine.createSpyObj<RestaurantTaxReceiptsService>(
      'RestaurantTaxReceiptsService',
      ['getDetail', 'save'],
    );
    svc.getDetail.and.returnValue(of(makeDetail()));
    svc.save.and.returnValue(of({}));

    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'clear',
    ]);

    await TestBed.configureTestingModule({
      imports: [TaxReceiptsComponent],
      providers: [
        provideRouter([]),
        { provide: RestaurantTaxReceiptsService, useValue: svc },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaxReceiptsComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
  });

  it('creates and loads the four fields into the form', () => {
    expect(component).toBeTruthy();
    expect(component.loadState).toBe('ready');
    expect(component.vatRegistered).toBeTrue();
    expect(component.form.get('vat_rate')!.value).toBe(18);
    expect(component.form.get('tin')!.value).toBe('1000123456');
    expect(component.form.get('receipt_footer')!.value).toBe('Thanks for dining with us!');
    expect(component.isDirty).toBeFalse();
  });

  it('sets the error state when the detail load fails', () => {
    svc.getDetail.and.returnValue(throwError(() => new Error('boom')));
    component.load();
    expect(component.loadState).toBe('error');
  });

  it('applies VAT rate validators only when registered', () => {
    svc.getDetail.and.returnValue(of(makeDetail({ vat_registered: false })));
    component.load();
    expect(component.vatRegistered).toBeFalse();

    // Rate is not required while unregistered — an empty rate must not block save.
    component.form.get('vat_rate')!.setValue('');
    expect(component.form.valid).toBeTrue();

    // Turning registration on makes the rate required again.
    component.onVatRegisteredToggle(true);
    expect(component.vatRegistered).toBeTrue();
    expect(component.form.get('vat_rate')!.invalid).toBeTrue();
  });

  it('saves the four fields, sending a clean decimal string for the rate', () => {
    component.form.get('tin')!.setValue('1000999888');
    component.form.get('tin')!.markAsDirty();
    expect(component.isDirty).toBeTrue();

    component.onSave();

    expect(svc.save).toHaveBeenCalledTimes(1);
    expect(svc.save.calls.mostRecent().args[0]).toEqual({
      id: 'r1',
      vat_registered: true,
      vat_rate: '18',
      tin: '1000999888',
      receipt_footer: 'Thanks for dining with us!',
    });
    expect(toast.success).toHaveBeenCalled();
    // Re-fetch re-syncs the loaded baseline.
    expect(component.isDirty).toBeFalse();
  });

  it('sends null for an emptied tin and receipt_footer (null-clears)', () => {
    component.form.get('tin')!.setValue('');
    component.form.get('receipt_footer')!.setValue('   ');
    component.form.markAsDirty();

    component.onSave();

    const payload = svc.save.calls.mostRecent().args[0] as { tin: unknown; receipt_footer: unknown };
    expect(payload.tin).toBeNull();
    expect(payload.receipt_footer).toBeNull();
  });

  it('blocks the save and toasts when the rate is invalid while registered', () => {
    component.form.get('vat_rate')!.setValue(150); // > 100
    component.form.markAsDirty();

    component.onSave();

    expect(svc.save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('discards back to the loaded values and goes pristine', () => {
    component.form.get('tin')!.setValue('changed');
    component.form.get('tin')!.markAsDirty();
    expect(component.isDirty).toBeTrue();

    component.onDiscard();

    expect(component.form.get('tin')!.value).toBe('1000123456');
    expect(component.isDirty).toBeFalse();
  });
});
