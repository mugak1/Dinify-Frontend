import {
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { getMockTickets } from '../mock/kitchen-mock-data';
import { KitchenOrderService } from './kitchen-order.service';

describe('KitchenOrderService', () => {
  let service: KitchenOrderService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any };

  /** Active-orders envelope wrapping a fresh mock set (stable ids k-01…k-20). */
  function freshTickets() {
    return { status: 200, data: { records: getMockTickets() } };
  }

  beforeEach(() => {
    apiStub = {
      get: jasmine.createSpy('get').and.callFake(() => of(freshTickets())),
      postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
    };
    authStub = {
      userValue: {
        profile: { restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] },
      },
    };
    TestBed.configureTestingModule({
      providers: [
        KitchenOrderService,
        { provide: ApiService, useValue: apiStub },
        { provide: AuthenticationService, useValue: authStub },
      ],
    });
    service = TestBed.inject(KitchenOrderService);
  });

  /**
   * Populate the store via one real-path poll, then halt the loop. The stubbed
   * api.get emits synchronously, so the first poll resolves inside startPolling()
   * before any timer is due; stopPolling() clears the scheduled next poll.
   */
  function load(): void {
    service.startPolling();
    service.stopPolling();
  }

  it('is created with no tickets and connected', () => {
    expect(service).toBeTruthy();
    expect(service.activeTickets().length).toBe(0);
    expect(service.connectionState()).toBe('connected');
  });

  it('polls the active set into the store, scoped to the restaurant', () => {
    load();
    expect(apiStub.get).toHaveBeenCalledWith(null, 'kitchen/orders/active/', { restaurant: 'r1' });
    expect(service.activeTickets().length).toBeGreaterThan(10);
  });

  it('orders the oldest priority ticket first', () => {
    load();
    const first = service.activeTickets()[0];
    expect(first.priority).toBe(true);
    // k-10 is the oldest priority ticket in the mock set (19 min).
    expect(first.id).toBe('k-10');
  });

  describe('advanceStatus', () => {
    it('accepts a legal forward step and PATCHes fulfilment-status', () => {
      load();
      expect(service.advanceStatus('k-01', 'preparing')).toBe(true);
      expect(service.activeTickets().find(t => t.id === 'k-01')!.fulfilment_status).toBe('preparing');
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/fulfilment-status/', { fulfilment_status: 'preparing' }, 'put');
    });

    it('rejects an illegal skip and leaves state unchanged (no PATCH)', () => {
      load();
      expect(service.advanceStatus('k-01', 'ready')).toBe(false);
      expect(service.activeTickets().find(t => t.id === 'k-01')!.fulfilment_status).toBe('new');
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });

    it('stamps served_at when advancing to served', () => {
      load();
      // k-11 is 'ready' → served is the legal next step.
      expect(service.advanceStatus('k-11', 'served')).toBe(true);
      const t = service.activeTickets().find(x => x.id === 'k-11')!;
      expect(t.fulfilment_status).toBe('served');
      expect(t.served_at).not.toBeNull();
    });

    it('reverts the optimistic change when the PATCH fails', () => {
      load();
      apiStub.postPatch.and.returnValue(throwError(() => new Error('patch failed')));
      expect(service.advanceStatus('k-01', 'preparing')).toBe(true);
      // Optimistic flip rolled back by the error handler.
      expect(service.activeTickets().find(t => t.id === 'k-01')!.fulfilment_status).toBe('new');
    });
  });

  describe('recall', () => {
    it('recalls a served ticket within the window (clears served_at) and PATCHes', () => {
      load();
      // k-14 was served 3 min ago — inside the 10-min window.
      expect(service.recall('k-14')).toBe(true);
      const t = service.activeTickets().find(x => x.id === 'k-14')!;
      expect(t.fulfilment_status).toBe('ready');
      expect(t.served_at).toBeNull();
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-14/fulfilment-status/', { fulfilment_status: 'ready' }, 'put');
    });

    it('rejects recall of a served ticket beyond the window', () => {
      load();
      // k-16 was served 14 min ago — past the 10-min window.
      expect(service.recall('k-16')).toBe(false);
      expect(service.activeTickets().find(x => x.id === 'k-16')!.fulfilment_status).toBe('served');
    });

    it('recalls a ready ticket back to preparing at any time', () => {
      load();
      expect(service.recall('k-11')).toBe(true);
      expect(service.activeTickets().find(x => x.id === 'k-11')!.fulfilment_status).toBe('preparing');
    });
  });

  describe('togglePriority', () => {
    it('flips priority and PATCHes', () => {
      load();
      const before = service.activeTickets().find(t => t.id === 'k-01')!.priority;
      service.togglePriority('k-01');
      expect(service.activeTickets().find(t => t.id === 'k-01')!.priority).toBe(!before);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/priority/', { priority: !before }, 'put');
    });

    it('reverts priority when the PATCH fails', () => {
      load();
      const before = service.activeTickets().find(t => t.id === 'k-01')!.priority;
      apiStub.postPatch.and.returnValue(throwError(() => new Error('patch failed')));
      service.togglePriority('k-01');
      expect(service.activeTickets().find(t => t.id === 'k-01')!.priority).toBe(before);
    });
  });

  describe('cancelOrder', () => {
    it('removes the ticket optimistically and PUTs the structured reason', () => {
      load();
      expect(service.activeTickets().some(t => t.id === 'k-01')).toBe(true);
      service.cancelOrder('k-01', 'kitchen_error');
      expect(service.activeTickets().some(t => t.id === 'k-01')).toBe(false);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/cancel/', { cancellation_reason: 'kitchen_error' }, 'put');
    });

    it('re-adds the ticket when the cancel call fails', () => {
      load();
      apiStub.postPatch.and.returnValue(throwError(() => new Error('cancel failed')));
      service.cancelOrder('k-01', 'duplicate');
      expect(service.activeTickets().some(t => t.id === 'k-01')).toBe(true);
    });

    it('is a no-op for an unknown id (no PATCH)', () => {
      load();
      service.cancelOrder('does-not-exist', 'other');
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });
  });

  describe('isManager', () => {
    it('is false when the active membership has no owner/manager role', () => {
      expect(service.isManager).toBe(false); // default stub: ['kitchen']
    });

    it('is true when the roles include manager or owner', () => {
      authStub.userValue.profile.restaurant_roles[0].roles = ['manager'];
      expect(service.isManager).toBe(true);
      authStub.userValue.profile.restaurant_roles[0].roles = ['owner'];
      expect(service.isManager).toBe(true);
    });
  });

  describe('connection state (derived from poll outcomes)', () => {
    it('drives connected → reconnecting → offline on consecutive failures with backoff', fakeAsync(() => {
      apiStub.get.and.returnValue(throwError(() => new Error('net')));
      service.startPolling();                              // poll #1 fails now (1 failure)
      expect(service.connectionState()).toBe('reconnecting');
      tick(5000);                                          // poll #2 (5s after 1 failure)
      expect(service.connectionState()).toBe('reconnecting');
      tick(10000);                                         // poll #3 (10s after 2 failures)
      expect(service.connectionState()).toBe('offline');
      service.stopPolling();
      discardPeriodicTasks();
    }));

    it('snaps back to connected at the base cadence on recovery', fakeAsync(() => {
      apiStub.get.and.returnValue(throwError(() => new Error('net')));
      service.startPolling();
      tick(5000);
      tick(10000);
      expect(service.connectionState()).toBe('offline');

      apiStub.get.and.callFake(() => of(freshTickets()));
      tick(10000);                                         // next attempt (10s) succeeds
      expect(service.connectionState()).toBe('connected');
      expect(service.activeTickets().length).toBeGreaterThan(10);
      tick(3000);                                          // base 3s cadence resumed
      expect(service.connectionState()).toBe('connected');
      service.stopPolling();
      discardPeriodicTasks();
    }));
  });

  describe('dev controls (mock-only aids)', () => {
    it('injects a brand-new ticket in "new" status', () => {
      load();
      const before = service.activeTickets().length;
      const injected = service.injectNewTicket();
      expect(service.activeTickets().length).toBe(before + 1);
      expect(injected.fulfilment_status).toBe('new');
      expect(service.activeTickets().some(t => t.id === injected.id)).toBe(true);
    });

    it('simulates connection states', () => {
      service.simulateConnectionState('reconnecting');
      expect(service.connectionState()).toBe('reconnecting');
      service.simulateConnectionState('offline');
      expect(service.connectionState()).toBe('offline');
    });
  });

  describe('pruneServed', () => {
    it('drops served tickets past the recall window only', () => {
      load();
      expect(service.activeTickets().some(t => t.id === 'k-16')).toBe(true);
      service.pruneServed(Date.now());
      expect(service.activeTickets().some(t => t.id === 'k-16')).toBe(false); // 14 min → pruned
      expect(service.activeTickets().some(t => t.id === 'k-14')).toBe(true);  // 3 min → kept
    });
  });
});
