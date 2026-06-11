import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenMenuItem } from '../models/kitchen.models';
import { KitchenStockService } from './kitchen-stock.service';

/** Fresh item set: two sections, one already sold out (m2). */
function items(): KitchenMenuItem[] {
  return [
    { id: 'm1', name: 'Margherita Pizza', in_stock: true, available: true, section_name: 'Pizzas' },
    { id: 'm2', name: 'Pepperoni Pizza', in_stock: false, available: true, section_name: 'Pizzas' },
    { id: 'm3', name: 'Cola', in_stock: true, available: true, section_name: 'Drinks' },
  ];
}

describe('KitchenStockService', () => {
  let service: KitchenStockService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any };

  /** Menu-items envelope wrapping a fresh set. */
  function freshItems() {
    return { status: 200, data: { records: items() } };
  }

  beforeEach(() => {
    apiStub = {
      get: jasmine.createSpy('get').and.callFake(() => of(freshItems())),
      postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
    };
    authStub = {
      userValue: {
        profile: { restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] },
      },
    };
    TestBed.configureTestingModule({
      providers: [
        KitchenStockService,
        { provide: ApiService, useValue: apiStub },
        { provide: AuthenticationService, useValue: authStub },
      ],
    });
    service = TestBed.inject(KitchenStockService);
  });

  it('is created empty, not loading, with no sold-out items', () => {
    expect(service).toBeTruthy();
    expect(service.items().length).toBe(0);
    expect(service.soldOutCount()).toBe(0);
    expect(service.loading()).toBe(false);
  });

  it('loads items into the signal, scoped to the restaurant', () => {
    service.loadItems();
    expect(apiStub.get).toHaveBeenCalledWith(null, 'kitchen/menu-items/', { restaurant: 'r1' });
    expect(service.items().length).toBe(3);
    expect(service.loading()).toBe(false);
  });

  it('handles a bare-array envelope', () => {
    apiStub.get.and.returnValue(of({ status: 200, data: items() }));
    service.loadItems();
    expect(service.items().length).toBe(3);
  });

  it('computes soldOutCount from in_stock === false', () => {
    service.loadItems();
    expect(service.soldOutCount()).toBe(1);
  });

  it('keeps the last-known list and clears loading when the fetch fails', () => {
    service.loadItems();
    apiStub.get.and.returnValue(throwError(() => new Error('net')));
    service.loadItems();
    expect(service.items().length).toBe(3); // unchanged — not blanked
    expect(service.loading()).toBe(false);
  });

  describe('toggleStock', () => {
    it('flips in_stock optimistically and PUTs', () => {
      service.loadItems();
      service.toggleStock('m1', false);
      expect(service.items().find(i => i.id === 'm1')!.in_stock).toBe(false);
      expect(service.soldOutCount()).toBe(2);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/menu-items/m1/stock/', { in_stock: false }, 'put');
    });

    it('un-86s an item (back in stock) and PUTs', () => {
      service.loadItems();
      service.toggleStock('m2', true);
      expect(service.items().find(i => i.id === 'm2')!.in_stock).toBe(true);
      expect(service.soldOutCount()).toBe(0);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/menu-items/m2/stock/', { in_stock: true }, 'put');
    });

    it('reverts the optimistic flip when the PUT fails', () => {
      service.loadItems();
      apiStub.postPatch.and.returnValue(throwError(() => new Error('patch failed')));
      service.toggleStock('m1', false);
      expect(service.items().find(i => i.id === 'm1')!.in_stock).toBe(true);
      expect(service.soldOutCount()).toBe(1);
    });

    it('is a no-op for an unknown id', () => {
      service.loadItems();
      service.toggleStock('nope', false);
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });
  });
});
