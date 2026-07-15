import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { WINDOW } from '../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../_services/storage/storage-key-prefix.token';
import { MenuItemDetailComponent } from './menu-item-detail.component';
import { DiscountDetails, MenuItem, MenuItemExtraRef } from '../../_models/app.models';
import { parseModifierGroups } from '../../_common/utils/modifier-utils';
import { BasketService } from '../../_services/basket.service';
import { ToastService } from '../../_shared/ui/toast/toast.service';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function pct(percentage: number): DiscountDetails {
  return {
    discount_type: 'percentage',
    discount_percentage: percentage,
    discount_amount: 0,
    recurring_days: ALL_DAYS,
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
  };
}

function fixed(amount: number): DiscountDetails {
  return {
    discount_type: 'fixed',
    discount_percentage: 0,
    discount_amount: amount,
    recurring_days: ALL_DAYS,
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
  };
}

// A percentage discount whose window has already closed (end_date in the past).
// isDiscountActive returns false regardless of "today", so the effective price
// falls back to base — lets us assert the out-of-window path deterministically.
function expiredPct(percentage: number): DiscountDetails {
  return { ...pct(percentage), end_date: '2000-01-01' };
}

function extraRef(primary: number, dd: DiscountDetails | null = null): MenuItemExtraRef {
  return { id: 'e1', name: 'Cheese', primary_price: String(primary), discount_details: dd };
}

describe('MenuItemDetailComponent', () => {
  let component: MenuItemDetailComponent;
  let fixture: ComponentFixture<MenuItemDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [MenuItemDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(MenuItemDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('announces the add / edit result via a global toast', () => {
    const toast = TestBed.inject(ToastService);
    const successSpy = spyOn(toast, 'success');
    const basket = TestBed.inject(BasketService);
    spyOn(basket, 'addItem');
    spyOn(basket, 'updateItem');
    spyOn(TestBed.inject(Router), 'navigate');
    spyOn(component, 'isFormValid').and.returnValue(true);
    component.item.set({ id: 'i1', name: 'Burger', primary_price: '5000', in_stock: true } as unknown as MenuItem);

    component.editingIndex.set(null);
    component.addToBasket();
    expect(successSpy).toHaveBeenCalledWith('Added to basket');

    component.editingIndex.set(3);
    component.addToBasket();
    expect(successSpy).toHaveBeenCalledWith('Changes saved');
  });

  describe('extra discount pricing', () => {
    it('prices an active percentage discount below base', () => {
      const o = extraRef(1000, pct(20));
      expect(component.extraEffectivePrice(o)).toBe(800);
      expect(component.extraIsDiscounted(o)).toBe(true);
    });

    it('prices an active fixed-amount discount below base', () => {
      const o = extraRef(1000, fixed(200));
      expect(component.extraEffectivePrice(o)).toBe(800);
      expect(component.extraIsDiscounted(o)).toBe(true);
    });

    it('falls back to base when there is no discount', () => {
      expect(component.extraEffectivePrice(extraRef(1000, null))).toBe(1000);
      expect(component.extraIsDiscounted(extraRef(1000, null))).toBe(false);
      // An empty object is the backend default for a non-discounted extra.
      expect(component.extraIsDiscounted(extraRef(1000, {} as DiscountDetails))).toBe(false);
    });

    it('falls back to base for an out-of-window discount', () => {
      const o = extraRef(1000, expiredPct(20));
      expect(component.extraEffectivePrice(o)).toBe(1000);
      expect(component.extraIsDiscounted(o)).toBe(false);
    });
  });

  describe('main-item discount pricing (server truth)', () => {
    // The detail price block + "You save" block are *ngIf-gated on
    // discountIsLive(it); figures come from the server's current_price.
    it('gates off and falls back to primary when the server says inactive', () => {
      const it = { primary_price: '10000', current_price: '10000', is_discount_active: false } as any;
      expect(component.discountIsLive(it)).toBe(false);
      expect(component.getDisplayPrice(it)).toBe(10000);
      expect(component.priceSaved(it)).toBe(0);
    });

    it('shows the discounted price and savings when the server says active', () => {
      const it = { primary_price: '10000', current_price: '8000', is_discount_active: true } as any;
      expect(component.discountIsLive(it)).toBe(true);
      expect(component.getDisplayPrice(it)).toBe(8000);
      expect(component.priceSaved(it)).toBe(2000);
    });
  });

  // ── tenant isolation: item customisation + public fetch contract ───────────
  // The item-detail screen is the diner's customise-before-basket surface, and a
  // second public caller of show-menu. These pin that (a) modifiers/extras still
  // parse and toggle after the menu-flow contract change, and (b) this public
  // fetch, like the menu list, never sends the ignore-approval preview flag.
  describe('modifiers & extras remain functional', () => {
    const itemWithOptions = () =>
      ({
        id: 'i1',
        name: 'Pizza',
        primary_price: '20000',
        in_stock: true,
        options: {
          hasModifiers: true,
          groups: [
            {
              id: 'g1',
              name: 'Size',
              selectionType: 'single',
              minSelections: 1,
              maxSelections: 1,
              choices: [
                { id: 'c1', name: 'Small', additionalCost: 0, available: true },
                { id: 'c2', name: 'Large', additionalCost: 5000, available: true },
                { id: 'c3', name: 'Sold out', additionalCost: 0, available: false },
              ],
            },
          ],
        },
        extras: [{ id: 'e1', name: 'Cheese', primary_price: '1000', discount_details: null }],
      }) as unknown as MenuItem;

    it('parses grouped modifiers (drops unavailable choices, single-select capped) and toggles a choice', () => {
      const item = itemWithOptions();
      component.item.set(item);
      component.modifierGroups.set(parseModifierGroups(item.options));

      const groups = component.modifierGroups();
      expect(groups.length).toBe(1);
      expect(groups[0].choices.length).toBe(2); // the unavailable choice is filtered out
      expect(groups[0].selectionType).toBe('single');
      expect(groups[0].maxSelections).toBe(1);
      expect(groups[0].required).toBeTrue(); // minSelections > 0

      component.handleModifierSingleSelect('g1', 'c1');
      expect(component.isModifierChoiceSelected('g1', 'c1')).toBeTrue();
      expect(component.getModifierSelectedCount('g1')).toBe(1);
    });

    it('toggles an extra on and off by id', () => {
      component.item.set(itemWithOptions());

      component.toggleExtraById('e1');
      expect(component.selectedExtras().some((e) => e.id === 'e1')).toBeTrue();

      component.toggleExtraById('e1');
      expect(component.selectedExtras().some((e) => e.id === 'e1')).toBeFalse();
    });
  });

  it('fetches the public menu without the ignore-approval preview flag', () => {
    const httpMock = TestBed.inject(HttpTestingController);

    // fetchMenu is the cold-load leg; beforeEach never triggers it (no route
    // params / no stored restaurant), so this is the only in-flight request.
    (component as unknown as { fetchMenu(id: string): void }).fetchMenu('r1');

    const req = httpMock.expectOne((r) => r.url.includes('show-menu'));
    expect(req.request.url).toContain('restaurant=r1');
    expect(req.request.url).not.toContain('ignore-approval');
    req.flush({ data: [], item_sort_mode: 'manual' });
    httpMock.verify();
  });
});
