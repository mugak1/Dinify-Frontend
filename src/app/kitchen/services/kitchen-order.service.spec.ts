import {
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import { getMockTickets } from '../mock/kitchen-mock-data';
import { KitchenOrderService } from './kitchen-order.service';

describe('KitchenOrderService', () => {
  let service: KitchenOrderService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any; currentRestaurantRole: any };

  /** Active-orders envelope wrapping a fresh mock set (stable ids k-01…k-20). */
  function freshTickets() {
    return { status: 200, data: { records: getMockTickets() } };
  }

  /** A served ticket completed `servedMinsAgo` minutes ago. */
  function makeServed(id: string, servedMinsAgo: number): KitchenTicket {
    return {
      id,
      order_number: 300,
      table_label: 'Table X',
      order_source: 'diner_self_service',
      fulfilment_status: 'served',
      priority: false,
      created_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      served_at: new Date(Date.now() - servedMinsAgo * 60_000).toISOString(),
      items: [],
    };
  }

  /** Completed-feed envelope: deliberately out of order so the sort is exercised. */
  function completedEnvelope() {
    return { status: 200, data: { records: [
      makeServed('c-1', 9), // oldest completion
      makeServed('c-2', 2), // newest completion
      makeServed('c-3', 5),
    ] } };
  }

  beforeEach(() => {
    apiStub = {
      get: jasmine.createSpy('get').and.callFake((_: any, url: string) =>
        url === 'kitchen/orders/completed/'
          ? of(completedEnvelope())
          : of(freshTickets())),
      postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
    };
    authStub = {
      userValue: {
        profile: { restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] },
      },
      // The login-selected membership (rest_role) — the service scopes to THIS,
      // not restaurant_roles[0]. Default: the single-membership case (selection == [0]).
      currentRestaurantRole: { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] },
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

    it('removes the ticket from the active store when advanced to served', () => {
      load();
      // k-11 is 'ready' → served is the legal next step.
      expect(service.activeTickets().some(t => t.id === 'k-11')).toBe(true);
      expect(service.advanceStatus('k-11', 'served')).toBe(true);
      expect(service.activeTickets().some(t => t.id === 'k-11')).toBe(false);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-11/fulfilment-status/', { fulfilment_status: 'served' }, 'put');
    });

    it('re-adds the served ticket to the active store when the PATCH fails', () => {
      load();
      apiStub.postPatch.and.returnValue(throwError(() => new Error('patch failed')));
      expect(service.advanceStatus('k-11', 'served')).toBe(true);
      // Optimistic removal rolled back by the error handler.
      expect(service.activeTickets().some(t => t.id === 'k-11')).toBe(true);
    });

    it('reverts an in-place advance (not to served) when the PATCH fails', () => {
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

  describe('loadCompleted', () => {
    it('populates completedTickets newest-first by served_at, scoped to the restaurant', () => {
      service.loadCompleted().subscribe();
      expect(apiStub.get).toHaveBeenCalledWith(
        null, 'kitchen/orders/completed/', { restaurant: 'r1' });
      // c-2 (2 min) newest → c-3 (5 min) → c-1 (9 min) oldest.
      expect(service.completedTickets().map(t => t.id)).toEqual(['c-2', 'c-3', 'c-1']);
    });

    it('leaves the active store untouched', () => {
      load();
      const activeBefore = service.activeTickets().length;
      service.loadCompleted().subscribe();
      expect(service.activeTickets().length).toBe(activeBefore);
    });
  });

  describe('recallCompleted', () => {
    beforeEach(() => service.loadCompleted().subscribe());

    it('removes the ticket from completed and PATCHes served → ready', () => {
      expect(service.completedTickets().some(t => t.id === 'c-2')).toBe(true);
      service.recallCompleted('c-2');
      expect(service.completedTickets().some(t => t.id === 'c-2')).toBe(false);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/c-2/fulfilment-status/', { fulfilment_status: 'ready' }, 'put');
    });

    it('re-adds the ticket to completed when the recall PATCH fails', () => {
      apiStub.postPatch.and.returnValue(throwError(() => new Error('recall failed')));
      service.recallCompleted('c-2');
      expect(service.completedTickets().some(t => t.id === 'c-2')).toBe(true);
    });

    it('is a no-op for an unknown id (no PATCH)', () => {
      service.recallCompleted('does-not-exist');
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });
  });

  describe('isManager', () => {
    it('is false when the active membership has no owner/manager role', () => {
      expect(service.isManager).toBe(false); // default stub: ['kitchen']
    });

    it('is true when the roles include manager or owner', () => {
      authStub.currentRestaurantRole.roles = ['manager'];
      expect(service.isManager).toBe(true);
      authStub.currentRestaurantRole.roles = ['owner'];
      expect(service.isManager).toBe(true);
    });
  });

  // ── TENANT-P3-05 regression ────────────────────────────────────────────
  // The service must scope to the login-SELECTED membership (currentRestaurantRole,
  // backed by rest_role), NOT restaurant_roles[0]. A user at ≥2 restaurants who
  // picks their second at login must get THAT restaurant's board and void-gate.
  describe('restaurant scope honours the login-selected membership', () => {
    /** Two memberships; the user selected the SECOND (r2) at login. */
    function selectSecondMembership(selectedRoles: string[] = ['kitchen']): void {
      authStub.userValue.profile.restaurant_roles = [
        { restaurant_id: 'r1', restaurant: 'First', roles: ['kitchen'] },
        { restaurant_id: 'r2', restaurant: 'Second', roles: selectedRoles },
      ];
      authStub.currentRestaurantRole =
        { restaurant_id: 'r2', restaurant: 'Second', roles: selectedRoles };
    }

    it('scopes loadActive to the selected (second) restaurant, not restaurant_roles[0]', () => {
      selectSecondMembership();
      load();
      expect(apiStub.get).toHaveBeenCalledWith(
        null, 'kitchen/orders/active/', { restaurant: 'r2' });
    });

    it('scopes loadCompleted to the selected (second) restaurant, not restaurant_roles[0]', () => {
      selectSecondMembership();
      service.loadCompleted().subscribe();
      expect(apiStub.get).toHaveBeenCalledWith(
        null, 'kitchen/orders/completed/', { restaurant: 'r2' });
    });

    it('evaluates the void-gate against the selected membership roles, not restaurant_roles[0]', () => {
      // Selected (r2) is a manager; the FIRST membership is only kitchen.
      selectSecondMembership(['manager']);
      expect(service.isManager).toBe(true);
      // Inverse: first membership is owner, but the selected (r2) is only kitchen.
      authStub.userValue.profile.restaurant_roles[0].roles = ['owner'];
      authStub.currentRestaurantRole.roles = ['kitchen'];
      expect(service.isManager).toBe(false);
    });

    it('scopes a single-membership user to their only restaurant (unchanged)', () => {
      // Default stub: one membership (r1), which is also the selection.
      load();
      expect(apiStub.get).toHaveBeenCalledWith(
        null, 'kitchen/orders/active/', { restaurant: 'r1' });
    });

    it('omits the restaurant param when no membership is selected (defensive path)', () => {
      authStub.currentRestaurantRole = null; // rest_role absent → JSON.parse(null)
      load();
      expect(apiStub.get).toHaveBeenCalledWith(null, 'kitchen/orders/active/', {});
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
