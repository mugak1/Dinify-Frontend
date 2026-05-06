import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ItemFormDialogComponent } from './item-form-dialog.component';
import { MenuService } from '../../services/menu.service';
import { TagService } from '../../services/tag.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';

describe('ItemFormDialogComponent — canonical discount_details', () => {
  let fixture: ComponentFixture<ItemFormDialogComponent>;
  let component: ItemFormDialogComponent;

  beforeEach(async () => {
    const menuStub = {
      sections$: of([]),
      extras$: of([]),
    };
    const tagStub = {
      presetTags$: of([]),
    };
    const toastStub = { error: () => {}, success: () => {}, info: () => {} };

    await TestBed.configureTestingModule({
      imports: [ItemFormDialogComponent],
      providers: [
        { provide: MenuService, useValue: menuStub },
        { provide: TagService, useValue: tagStub },
        { provide: ToastService, useValue: toastStub },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemFormDialogComponent);
    component = fixture.componentInstance;
    component.sectionId = 'sec-1';
    fixture.detectChanges();
  });

  function fillBasicForm(primary = 10000) {
    component.form.patchValue({
      name: 'Test Item',
      section: 'sec-1',
      primary_price: primary,
    });
  }

  it('writes canonical percentage shape on save', () => {
    let payload: any = null;
    component.saved.subscribe(p => (payload = p));

    fillBasicForm(10000);
    component.itemHasDiscount = true;
    component.itemDiscountDetails = {
      discount_type: 'percentage',
      discount_amount: 20,
      start_date: '',
      end_date: '',
      recurring_days: [],
    };

    component.onSubmit();

    expect(payload).toBeTruthy();
    const dd = JSON.parse(payload.discount_details);
    expect(dd.discount_type).toBe('percentage');
    expect(dd.discount_percentage).toBe(20);
    expect(dd.discount_amount).toBe(0);
    expect(dd.raw_discount_value).toBeUndefined();
    expect(dd.raw_discount_type).toBeUndefined();
    expect(payload.discounted_price).toBe(8000);
    expect(payload.running_discount).toBe(true);
    expect(payload.consider_discount_object).toBe(true);
  });

  it('writes canonical fixed shape on save', () => {
    let payload: any = null;
    component.saved.subscribe(p => (payload = p));

    fillBasicForm(10000);
    component.itemHasDiscount = true;
    component.itemDiscountDetails = {
      discount_type: 'fixed',
      discount_amount: 2000,
      start_date: '',
      end_date: '',
      recurring_days: [],
    };

    component.onSubmit();

    const dd = JSON.parse(payload.discount_details);
    expect(dd.discount_type).toBe('fixed');
    expect(dd.discount_amount).toBe(2000);
    expect(dd.discount_percentage).toBe(0);
    expect(dd.raw_discount_value).toBeUndefined();
    expect(dd.raw_discount_type).toBeUndefined();
    expect(payload.discounted_price).toBe(8000);
    expect(payload.running_discount).toBe(true);
    expect(payload.consider_discount_object).toBe(true);
  });

  it('emits empty discount_details when discount is toggled off', () => {
    let payload: any = null;
    component.saved.subscribe(p => (payload = p));

    fillBasicForm(10000);
    component.itemHasDiscount = false;
    component.itemDiscountDetails = null;

    component.onSubmit();

    expect(JSON.parse(payload.discount_details)).toEqual({});
    expect(payload.discounted_price).toBeNull();
    expect(payload.running_discount).toBe(false);
    expect(payload.consider_discount_object).toBe(false);
  });

  it('loads canonical percentage shape into the form on edit', () => {
    component.item = {
      id: 'item-1',
      name: 'Existing',
      description: '',
      primary_price: 10000,
      discounted_price: 8000,
      running_discount: true,
      image: '',
      available: true,
      has_options: false,
      options: { hasModifiers: false, groups: [] },
      group: { id: null, name: null },
      allergens: [] as any,
      is_extra: false,
      has_extras: false,
      extras: [],
      has_discount: true,
      discount_details: {
        discount_type: 'percentage',
        discount_percentage: 20,
        discount_amount: 0,
        recurring_days: [1, 2, 3, 4, 5, 6, 7],
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
      },
    };

    component.open = true;
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
    } as any);

    expect(component.itemHasDiscount).toBe(true);
    expect(component.itemDiscountDetails?.discount_type).toBe('percentage');
    expect(component.itemDiscountDetails?.discount_amount).toBe(20);
  });

  it('loads canonical fixed shape into the form on edit', () => {
    component.item = {
      id: 'item-1',
      name: 'Existing',
      description: '',
      primary_price: 10000,
      discounted_price: 8000,
      running_discount: true,
      image: '',
      available: true,
      has_options: false,
      options: { hasModifiers: false, groups: [] },
      group: { id: null, name: null },
      allergens: [] as any,
      is_extra: false,
      has_extras: false,
      extras: [],
      has_discount: true,
      discount_details: {
        discount_type: 'fixed',
        discount_percentage: 0,
        discount_amount: 2000,
        recurring_days: [1, 2, 3, 4, 5, 6, 7],
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
      },
    };

    component.open = true;
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
    } as any);

    expect(component.itemDiscountDetails?.discount_type).toBe('fixed');
    expect(component.itemDiscountDetails?.discount_amount).toBe(2000);
  });

  it('treats item with no discount details as no-discount on edit', () => {
    component.item = {
      id: 'item-1',
      name: 'Existing',
      description: '',
      primary_price: 10000,
      discounted_price: null,
      running_discount: false,
      image: '',
      available: true,
      has_options: false,
      options: { hasModifiers: false, groups: [] },
      group: { id: null, name: null },
      allergens: [] as any,
      is_extra: false,
      has_extras: false,
      extras: [],
      has_discount: false,
      discount_details: null,
    };

    component.open = true;
    component.ngOnChanges({
      open: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true },
    } as any);

    expect(component.itemHasDiscount).toBe(false);
    expect(component.itemDiscountDetails).toBeNull();
  });
});
