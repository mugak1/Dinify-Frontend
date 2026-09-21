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

  // ── D07 / PR-7: the copy states STORAGE, never APPLICATION ────────────────
  //
  // These two screens describe what Dinify does with a value. Both used to
  // describe something it does not do. `vat_rate`, `vat_registered`, `tin` and
  // `receipt_footer` have NO production reader in either repository — they
  // appear only in the model, the write serializer and EDIT_INFORMATION — so
  // no quote carries a VAT line, no order stores one, no kitchen ticket shows
  // one, and nothing prints or issues a receipt.
  //
  // Copy is where that gap reaches a person. An operator who reads "the
  // percentage applied to taxable orders" sets a rate believing their prices
  // now carry VAT, and reconciles against a URA return on that belief. The
  // sentences are therefore pinned, VERBATIM and by ABSENCE, rather than left
  // to be softened back by the next edit.
  //
  // WHAT IS DELIBERATELY NOT DONE HERE: no tax is calculated, no quote is
  // altered, no receipt is created, and nothing infers legal tax compliance.
  // The fields stay saved, editable and untouched.

  function textOf(): string {
    return (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  }

  describe('states storage, never application (D07/PR-7)', () => {
    beforeEach(() => {
      // VAT on with a valid rate: the branch that renders the rate note.
      component.form.patchValue({ vat_registered: true, vat_rate: '18.00' });
      fixture.detectChanges();
    });

    it('REGRESSION: the VAT rate note says the value is saved, not applied', () => {
      expect(textOf()).toContain(
        'This value is saved for reference. Dinify does not currently use it to calculate tax on orders.',
      );
    });

    it('REGRESSION: no surface claims the rate is applied to orders', () => {
      const text = textOf().toLowerCase();

      // The exact phrase that shipped, plus the two ways it tends to come back.
      expect(text).not.toContain('applied to taxable orders');
      expect(text).not.toContain('will be applied');
      expect(text).not.toContain('is applied to');
    });

    it('REGRESSION: the VAT toggle says the rate is SHOWN, not that it applies', () => {
      // "The rate below applies only when this is on" reads as a statement
      // about when tax is charged. It is a statement about a form field.
      const text = textOf();

      expect(text).toContain('The rate below is only shown when this is on.');
      expect(text.toLowerCase()).not.toContain('rate below applies');
    });

    it('REGRESSION: the receipt copy does not claim a receipt is printed', () => {
      const text = textOf();

      expect(text).toContain(
        'Dinify does not currently print or issue customer receipts.',
      );
      // The present-tense claim that shipped.
      expect(text).not.toContain('What prints at the bottom of customer receipts');
    });

    it('CONTROL: the fields are still editable and still describe their purpose', () => {
      // The correction removes a CLAIM, not the feature. An operator must still
      // be able to record a rate, a TIN and a footer, and still be told what
      // each is for.
      const text = textOf();

      expect(text).toContain('VAT registered');
      expect(text).toContain('TIN');
      expect(text).toContain('The footer message saved for customer receipts.');
      expect(component.form.get('vat_rate')!.enabled).toBeTrue();
      expect(component.form.get('receipt_footer')!.enabled).toBeTrue();
    });

    it('CONTROL: an invalid rate still shows its validation error instead of the note', () => {
      component.form.patchValue({ vat_rate: '250' });
      component.form.get('vat_rate')!.markAsTouched();
      fixture.detectChanges();

      const text = textOf();
      expect(text).toContain('Enter a rate between 0 and 100');
      // The VAT-SPECIFIC sentence, not the shared "saved for reference"
      // prefix — the receipt-footer helper carries that phrase too and is
      // still on screen here, which is exactly why this names the whole claim.
      expect(text).not.toContain(
        'Dinify does not currently use it to calculate tax on orders.',
      );
    });
  });
});
