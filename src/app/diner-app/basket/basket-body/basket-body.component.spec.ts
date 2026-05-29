import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent', () => {
  let component: BasketBodyComponent;
  // Mutable basket backing the BasketService stub — basketItems is a getter over
  // basketService.Basket().items, so we drive it through this object per test.
  let basket: { items: BasketItem[]; totalAmount: number };

  function lineItem(overrides: Partial<BasketItem> = {}): BasketItem {
    return {
      itemId: 'i1',
      itemName: 'Burger',
      basePrice: 5000,
      totalPrice: 5000,
      quantity: 1,
      selectedModifiers: [],
      extras: [],
      isDiscounted: false,
      ...overrides,
    } as BasketItem;
  }

  beforeEach(async () => {
    basket = { items: [], totalAmount: 0 };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: { Basket: () => basket } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    // Construct only — no detectChanges(): these are pure pricing methods, so we
    // skip ngOnInit's storage subscription and the full template render.
    component = TestBed.createComponent(BasketBodyComponent).componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('counts a discounted extra on a non-discounted parent toward total savings', () => {
    basket.items = [
      lineItem({ extras: [{ id: 'e1', name: 'Cheese', cost: 800, originalCost: 1000 }] }),
    ];
    // original: (5000 base + 1000 extra original) * 1 = 6000
    // charged:  (5000 base +  800 extra cost)     * 1 = 5800
    expect(component.getTotalSavings()).toBe(200);
  });

  it('multiplies an extra-only saving by quantity', () => {
    basket.items = [
      lineItem({
        quantity: 2,
        extras: [{ id: 'e1', name: 'Cheese', cost: 800, originalCost: 1000 }],
      }),
    ];
    expect(component.getTotalSavings()).toBe(400);
  });

  it('reports no savings when neither parent nor extra is discounted', () => {
    basket.items = [lineItem({ extras: [{ id: 'e1', name: 'Cheese', cost: 800 }] })];
    expect(component.getTotalSavings()).toBe(0);
  });
});
