import {
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import { getMockTickets } from '../mock/kitchen-mock-data';
import { KitchenOrderService } from './kitchen-order.service';

describe('KitchenOrderService', () => {
  let service: KitchenOrderService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any; currentRestaurantRole: any };

  /** Active-orders envelope wrapping a fresh mock set (stable ids k-01…k-20).
   *  It DECLARES the kitchen protocol: a server that says nothing promises
   *  nothing, and the service withholds commands in that case (see the
   *  read-only specs below). */
  function freshTickets() {
    return { status: 200, kitchen_protocol: 1, data: { records: getMockTickets() } };
  }

  /** The current-state projection the server returns from every command. */
  function projection(over: Partial<any> = {}) {
    return {
      status: 200, message: 'Ticket updated', outcome: 'applied',
      data: {
        id: 'k-01', fulfilment_revision: 1, order_status: 'pending',
        fulfilment_status: 'preparing', priority: false, served_at: null,
        cancelled_at: null, cancellation_reason: null, ...over,
      },
    };
  }

  /** An authorised 409 carrying the server's reason and authoritative state. */
  function conflict(reason: string, state: Partial<any> = {}) {
    return {
      status: 409,
      error: {
        status: 409, message: 'This ticket changed since you loaded it.',
        reason,
        data: {
          id: 'k-01', fulfilment_revision: 7, order_status: 'pending',
          fulfilment_status: 'ready', priority: false, served_at: null,
          cancelled_at: null, cancellation_reason: null, ...state,
        },
      },
    };
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
      order_status: 'served',
      fulfilment_revision: 0,
    };
  }

  /** Completed-feed envelope: deliberately out of order so the sort is exercised. */
  function completedEnvelope() {
    return { status: 200, kitchen_protocol: 1, data: { records: [
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

  /** Re-point the active feed at the mock set MINUS one id (what the server
   *  does once an order is cancelled: it simply stops appearing). */
  function activeMinus(id: string): void {
    apiStub.get.and.callFake((_: any, url: string) =>
      url === 'kitchen/orders/completed/'
        ? of(completedEnvelope())
        : of({ status: 200, kitchen_protocol: 1,
               data: { records: getMockTickets().filter(t => t.id !== id) } }));
  }

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
    it('accepts a legal forward step and sends the explicit action + precondition', () => {
      load();
      expect(service.advanceStatus('k-01', 'preparing')).toBe(true);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/fulfilment-status/',
        { action: 'advance', if_revision: 0 }, 'put');
    });

    it('sends `serve` for the completion step, not `advance`', () => {
      load();
      // k-11 is 'ready' → served is the legal next step.
      expect(service.advanceStatus('k-11', 'served')).toBe(true);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-11/fulfilment-status/',
        { action: 'serve', if_revision: 0 }, 'put');
    });

    it('rejects an illegal skip and leaves state unchanged (no request)', () => {
      load();
      expect(service.advanceStatus('k-01', 'ready')).toBe(false);
      expect(service.activeTickets().find(t => t.id === 'k-01')!.fulfilment_status).toBe('new');
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });

    it('applies the SERVER projection on success, never a locally computed state', () => {
      load();
      apiStub.postPatch.and.returnValue(of(projection({
        id: 'k-01', fulfilment_status: 'preparing', fulfilment_revision: 4,
      })));
      service.advanceStatus('k-01', 'preparing');
      const t = service.activeTickets().find(x => x.id === 'k-01')!;
      expect(t.fulfilment_status).toBe('preparing');
      // The revision is the SERVER's — a client that guessed would send a
      // precondition the server never issued.
      expect(t.fulfilment_revision).toBe(4);
      expect(service.operationFor('k-01')).toBeUndefined();
    });

    it('moves a served ticket to the Completed store from the server projection', () => {
      load();
      apiStub.postPatch.and.returnValue(of(projection({
        id: 'k-11', fulfilment_status: 'served', order_status: 'served',
        served_at: new Date().toISOString(), fulfilment_revision: 1,
      })));
      service.advanceStatus('k-11', 'served');
      expect(service.activeTickets().some(t => t.id === 'k-11')).toBe(false);
      expect(service.completedTickets().some(t => t.id === 'k-11')).toBe(true);
    });

    it('keeps the ticket and shows a CONFLICT rather than rolling back', () => {
      // REGRESSION: a failed command used to restore an old snapshot, which
      // asserted the server had not acted. It now reports what the server said.
      load();
      apiStub.postPatch.and.returnValue(
        throwError(() => conflict('kitchen_precondition_stale',
                                  { id: 'k-01', fulfilment_status: 'ready' })));
      expect(service.advanceStatus('k-01', 'preparing')).toBe(true);

      const op = service.operationFor('k-01')!;
      expect(op.phase).toBe('conflict');
      expect(op.reason).toBe('kitchen_precondition_stale');
      // The card stays on the board, showing the server's authoritative state.
      const t = service.activeTickets().find(x => x.id === 'k-01')!;
      expect(t.fulfilment_status).toBe('ready');
      expect(t.fulfilment_revision).toBe(7);
    });

    it('reports UNKNOWN — never a rollback — when the answer is lost', () => {
      // REGRESSION: a timeout or transport failure is not evidence the server
      // did nothing, so the board must not assert that it did nothing.
      load();
      const before = service.activeTickets().find(t => t.id === 'k-01')!;
      apiStub.postPatch.and.returnValue(throwError(() => ({ status: 0 })));
      service.advanceStatus('k-01', 'preparing');

      const op = service.operationFor('k-01')!;
      expect(op.phase).toBe('unknown');
      expect(service.activeTickets().find(t => t.id === 'k-01')).toEqual(before);
    });

    it('never appends a duplicate card', () => {
      // REGRESSION: the old error handler did `[...tickets, ticket]`, so a poll
      // that had re-added the ticket left TWO cards with one id.
      load();
      apiStub.postPatch.and.returnValue(throwError(() => ({ status: 0 })));
      service.advanceStatus('k-11', 'served');
      load();
      const ids = service.activeTickets().map(t => t.id);
      expect(ids.filter(id => id === 'k-11').length).toBeLessThanOrEqual(1);
    });

    it('refuses a second command while one is unresolved', () => {
      load();
      apiStub.postPatch.and.returnValue(new Subject<any>().asObservable());
      expect(service.advanceStatus('k-01', 'preparing')).toBe(true);
      expect(service.isBusy('k-01')).toBe(true);
      expect(service.advanceStatus('k-01', 'preparing')).toBe(false);
      expect(apiStub.postPatch).toHaveBeenCalledTimes(1);
      // ...and unrelated tickets are untouched.
      expect(service.isBusy('k-02')).toBe(false);
    });
  });

  describe('recall', () => {
    it('recalls a served ticket within the window with the `recall` action', () => {
      load();
      // k-14 was served 3 min ago — inside the 10-min window.
      expect(service.recall('k-14')).toBe(true);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-14/fulfilment-status/',
        { action: 'recall', if_revision: 0 }, 'put');
    });

    it('rejects recall of a served ticket beyond the window', () => {
      load();
      // k-16 was served 14 min ago — past the 10-min window.
      expect(service.recall('k-16')).toBe(false);
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });

    it('sends `correct` for a ready ticket, not `recall`', () => {
      load();
      expect(service.recall('k-11')).toBe(true);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-11/fulfilment-status/',
        { action: 'correct', if_revision: 0 }, 'put');
    });
  });

  describe('priority', () => {
    it('sends an EXPLICIT value, never a toggle instruction', () => {
      load();
      const before = service.activeTickets().find(t => t.id === 'k-01')!.priority;
      service.setPriority('k-01', !before);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/priority/',
        { priority: !before, if_revision: 0 }, 'put');
    });

    it('togglePriority resolves the explicit value before sending', () => {
      load();
      const before = service.activeTickets().find(t => t.id === 'k-01')!.priority;
      service.togglePriority('k-01');
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/priority/',
        { priority: !before, if_revision: 0 }, 'put');
    });

    it('applies the server projection rather than the requested value', () => {
      load();
      apiStub.postPatch.and.returnValue(of(projection({
        id: 'k-01', priority: true, fulfilment_revision: 2,
      })));
      service.setPriority('k-01', true);
      const t = service.activeTickets().find(x => x.id === 'k-01')!;
      expect(t.priority).toBe(true);
      expect(t.fulfilment_revision).toBe(2);
    });

    it('shows a conflict instead of reverting when the command is refused', () => {
      load();
      apiStub.postPatch.and.returnValue(
        throwError(() => conflict('kitchen_precondition_stale',
                                  { id: 'k-01', priority: true })));
      service.setPriority('k-01', false);
      expect(service.operationFor('k-01')!.phase).toBe('conflict');
      expect(service.activeTickets().find(x => x.id === 'k-01')!.priority).toBe(true);
    });
  });

  describe('cancelOrder', () => {
    it('sends the structured reason and the precondition', () => {
      load();
      expect(service.cancelOrder('k-01', 'kitchen_error')).toBe(true);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/k-01/cancel/',
        { cancellation_reason: 'kitchen_error', if_revision: 0 }, 'put');
    });

    it('removes the ticket only once the SERVER says it is cancelled', () => {
      load();
      expect(service.activeTickets().some(t => t.id === 'k-01')).toBe(true);
      apiStub.postPatch.and.returnValue(of(projection({
        id: 'k-01', order_status: 'cancelled', fulfilment_status: 'new',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'kitchen_error', fulfilment_revision: 1,
      })));
      service.cancelOrder('k-01', 'kitchen_error');
      expect(service.activeTickets().some(t => t.id === 'k-01')).toBe(false);
      expect(service.completedTickets().some(t => t.id === 'k-01')).toBe(false);
    });

    it('does NOT resurrect a ticket whose cancel response was lost', () => {
      // REGRESSION: the old handler re-added the card, so a cancel the server
      // HAD applied came back onto the board as if it were still live.
      load();
      apiStub.postPatch.and.returnValue(throwError(() => ({ status: 0 })));
      service.cancelOrder('k-01', 'duplicate');
      expect(service.operationFor('k-01')!.phase).toBe('unknown');

      // The next poll is authoritative: the server omits the cancelled order.
      activeMinus('k-01');
      service.loadActive().subscribe();
      expect(service.activeTickets().some(t => t.id === 'k-01')).toBe(false);
    });

    it('is a no-op for an unknown id (no request)', () => {
      load();
      expect(service.cancelOrder('does-not-exist', 'other')).toBe(false);
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });
  });

  describe('read-only when the server does not declare the protocol', () => {
    it('withholds every command rather than sending the retired form', () => {
      apiStub.get.and.returnValue(
        of({ status: 200, data: { records: getMockTickets() } }));  // no protocol
      service.loadActive().subscribe();
      expect(service.canCommand()).toBe(false);
      expect(service.advanceStatus('k-01', 'preparing')).toBe(false);
      expect(service.recall('k-14')).toBe(false);
      expect(service.setPriority('k-01', true)).toBe(false);
      expect(service.cancelOrder('k-01', 'other')).toBe(false);
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });

    it('withholds a command for a ticket carrying no revision', () => {
      apiStub.get.and.returnValue(of({
        status: 200, kitchen_protocol: 1,
        data: { records: getMockTickets().map(t => {
          const rest: any = { ...(t as any) };
          delete rest.fulfilment_revision;
          return rest;
        }) },
      }));
      service.loadActive().subscribe();
      expect(service.canCommand()).toBe(true);
      // A revision must never be invented: that would defeat the check.
      expect(service.advanceStatus('k-01', 'preparing')).toBe(false);
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });
  });

  describe('stale reads and cross-context answers', () => {
    it('an unreadable envelope does NOT empty the board', () => {
      // REGRESSION: extractTickets returned [] for a shape it could not read,
      // which is indistinguishable from "no active orders".
      load();
      const before = service.activeTickets().length;
      expect(before).toBeGreaterThan(0);
      apiStub.get.and.returnValue(of({ status: 200, data: { unexpected: 1 } }));
      service.loadActive().subscribe();
      expect(service.activeTickets().length).toBe(before);
      expect(service.feedUnreadable()).toBe(true);
    });

    it('a valid empty array IS a valid empty board', () => {
      load();
      apiStub.get.and.returnValue(
        of({ status: 200, kitchen_protocol: 1, data: { records: [] } }));
      service.loadActive().subscribe();
      expect(service.activeTickets().length).toBe(0);
      expect(service.feedUnreadable()).toBe(false);
    });

    it('a delayed read does not overwrite a newer one', () => {
      // REGRESSION: loadActive() used to `set()` unconditionally, so an older
      // in-flight response replaced the store wholesale when it landed.
      const slow = new Subject<any>();
      apiStub.get.and.returnValue(slow.asObservable());
      service.loadActive().subscribe();

      apiStub.get.and.returnValue(of({
        status: 200, kitchen_protocol: 1,
        data: { records: [{ ...getMockTickets()[0], id: 'newer' }] },
      }));
      service.loadActive().subscribe();
      expect(service.activeTickets().map(t => t.id)).toEqual(['newer']);

      slow.next({ status: 200, kitchen_protocol: 1,
                  data: { records: [{ ...getMockTickets()[0], id: 'older' }] } });
      slow.complete();
      expect(service.activeTickets().map(t => t.id)).toEqual(['newer']);
    });

    it('a scope change clears the board and discards the previous context\'s answer', () => {
      load();
      expect(service.activeTickets().length).toBeGreaterThan(0);
      const held = new Subject<any>();
      apiStub.postPatch.and.returnValue(held.asObservable());
      service.advanceStatus('k-01', 'preparing');

      // The operator switches restaurant.
      authStub.currentRestaurantRole = {
        restaurant_id: 'r2', restaurant: 'R2', roles: ['kitchen'],
      };
      apiStub.get.and.returnValue(
        of({ status: 200, kitchen_protocol: 1, data: { records: [] } }));
      service.loadActive().subscribe();
      expect(service.activeTickets().length).toBe(0);
      expect(service.operationFor('k-01')).toBeUndefined();

      // The previous restaurant's answer lands and changes nothing here.
      held.next(projection({ id: 'k-01' }));
      held.complete();
      expect(service.activeTickets().length).toBe(0);
      expect(service.operationFor('k-01')).toBeUndefined();
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

    it('sends the `recall` action and the precondition', () => {
      // c-2 was served 2 min ago — inside the window.
      expect(service.recallCompleted('c-2')).toBe(true);
      expect(apiStub.postPatch).toHaveBeenCalledWith(
        'kitchen/orders/c-2/fulfilment-status/',
        { action: 'recall', if_revision: 0 }, 'put');
    });

    it('APPLIES THE ELIGIBILITY RULE it used to skip entirely', () => {
      // REGRESSION: this path never called isRecallEligible, so the ten-minute
      // window existed only in a helper nothing on the Completed view invoked.
      // c-1 was served 9 min ago (inside); the boundary is the SERVER's rule —
      // this check only saves a round trip.
      expect(service.recallCompleted('c-1')).toBe(true);
      apiStub.postPatch.calls.reset();
      // A ticket served long ago is refused locally too.
      service['_completed'].set([makeServed('old', 45)]);
      expect(service.recallCompleted('old')).toBe(false);
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });

    it('moves the ticket back to the active board from the server projection', () => {
      apiStub.postPatch.and.returnValue(of(projection({
        id: 'c-2', fulfilment_status: 'ready', order_status: 'pending',
        served_at: null, fulfilment_revision: 1,
      })));
      service.recallCompleted('c-2');
      expect(service.completedTickets().some(t => t.id === 'c-2')).toBe(false);
      expect(service.activeTickets().some(t => t.id === 'c-2')).toBe(true);
    });

    it('keeps the completed card and shows the refusal, never a silent revert', () => {
      apiStub.postPatch.and.returnValue(
        throwError(() => conflict('recall_window_expired',
                                  { id: 'c-2', fulfilment_status: 'served',
                                    order_status: 'served' })));
      service.recallCompleted('c-2');
      expect(service.completedTickets().some(t => t.id === 'c-2')).toBe(true);
      const op = service.operationFor('c-2')!;
      expect(op.phase).toBe('conflict');
      expect(op.reason).toBe('recall_window_expired');
    });

    it('is a no-op for an unknown id (no request)', () => {
      expect(service.recallCompleted('does-not-exist')).toBe(false);
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
