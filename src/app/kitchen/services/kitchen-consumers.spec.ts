/**
 * R1–R3 — the D05 guarantees, AT THE CONSUMERS THAT STILL BYPASS THEM.
 *
 * K1–K3 established the right rules. This file is about the writers and
 * callbacks those rules never reached:
 *
 *   R1a  `mergeFeed` orders feeds by LOCAL request sequence and never compares
 *        the incoming row's `fulfilment_revision` against the newest server
 *        revision it already knows. Client request-start order is not server
 *        observation order, so a later-STARTED read carrying an older SERVER
 *        snapshot moves a ticket backwards — across feeds, and back onto a
 *        board it had left.
 *   R1b  `resolveFailure` merges an authorised conflict's projection with
 *        membership changes DISABLED, so a 409 that says "cancelled" repaints
 *        the card and leaves it sitting on Active.
 *   R2a  `retry()` re-sends without the capability gate `issue()` applies.
 *   R2b  every callback resolves `_operations[id]` on arrival, so an answer to
 *        a retired question can rewrite a newer one at the same order id.
 *   R2c  an unchanged observation is reported as proof the command never
 *        arrived. The state read takes no lock; it is not proof of anything.
 *   R3   a success is validated as "a readable projection about the right
 *        order" and never against the command that was issued, so an
 *        impossible result clears the operation.
 *
 * EVERYTHING HERE DRIVES THE REAL SERVICE THROUGH THE REAL `ApiService` AND
 * `HttpClient`. `HttpTestingController` is what supplies the distinct start /
 * observation / arrival barriers these interleavings need: a request is opened
 * when the spec calls the service and answered when the spec flushes it, so
 * "which read started first" and "which answer arrived first" are independent,
 * which is the whole point.
 *
 * `httpMock.verify()` is deliberately NOT called: several specs leave a request
 * open on purpose, because an outstanding answer IS the fixture.
 */

import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';

import { environment } from '../../../environments/environment';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import { KitchenOrderService } from './kitchen-order.service';

const API = `${environment.apiUrl}/api/${environment.version}`;
const ID = 'k-01';

function ticket(over: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: ID,
    order_number: 1,
    table_label: 'Table 1',
    order_source: 'diner_self_service',
    fulfilment_status: 'new',
    priority: false,
    created_at: new Date().toISOString(),
    served_at: null,
    items: [],
    order_status: 'pending',
    fulfilment_revision: 0,
    ...over,
  };
}

/** A protocol-declaring feed envelope. */
/**
 * A feed envelope. Pass `null` — NOT `undefined` — to omit the protocol
 * declaration: an explicitly passed `undefined` triggers a default parameter,
 * so `feed(rows, undefined)` quietly built a DECLARING envelope and the
 * read-only fixtures below were never read-only at all.
 */
function feed(records: any[], protocol: number | null = 1) {
  const body: any = { status: 200, data: { records } };
  if (protocol !== null) body.kitchen_protocol = protocol;
  return body;
}

/** The server's current-state projection. */
function state(over: Partial<any> = {}) {
  return {
    id: ID,
    fulfilment_revision: 1,
    order_status: 'pending',
    fulfilment_status: 'preparing',
    priority: false,
    served_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    ...over,
  };
}

describe('D05 R1–R3 at the response consumers', () => {
  let service: KitchenOrderService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        ApiService,
        KitchenOrderService,
        {
          provide: AuthenticationService,
          useValue: {
            userValue: { profile: { id: 'u1', restaurant_roles: [] } },
            currentRestaurantRole:
              { restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] },
          },
        },
      ],
    });
    service = TestBed.inject(KitchenOrderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  const activeReq = () =>
    httpMock.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/active/`));
  const completedReq = () =>
    httpMock.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/completed/`));
  const openActive = () =>
    httpMock.match(r => r.url.startsWith(`${API}/kitchen/orders/active/`));
  const openCompleted = () =>
    httpMock.match(r => r.url.startsWith(`${API}/kitchen/orders/completed/`));

  /** Start AND answer one active read. */
  function seedActive(records: any[]): void {
    service.loadActive().subscribe({ error: () => undefined });
    activeReq().flush(feed(records));
  }
  function seedCompleted(records: any[]): void {
    service.loadCompleted().subscribe({ error: () => undefined });
    completedReq().flush(feed(records));
  }

  const activeIds = () => service.activeTickets().map(t => t.id);
  const completedIds = () => service.completedTickets().map(t => t.id);
  const activeRev = () =>
    service.activeTickets()[0]?.fulfilment_revision;
  const completedRev = () =>
    service.completedTickets()[0]?.fulfilment_revision;

  // ── R1a: server revision, not local request order ────────────────────

  describe('R1a — a later-started read carrying an older server snapshot', () => {
    it('cannot move a ticket back onto Completed at a superseded revision', () => {
      // 1. Completed holds the order, served at revision 3.
      seedCompleted([ticket({ fulfilment_status: 'served', order_status: 'served',
                              served_at: new Date().toISOString(),
                              fulfilment_revision: 3 })]);
      expect(completedIds()).toEqual([ID]);

      // 2/3. Active read A starts FIRST, Completed read B starts SECOND. Both
      //      are then held before their server observation is delivered.
      service.loadActive().subscribe({ error: () => undefined });
      service.loadCompleted().subscribe({ error: () => undefined });
      const a = openActive();
      const b = openCompleted();
      expect(a.length).toBe(1);
      expect(b.length).toBe(1);

      // 4/5. Another device legitimately recalls the order — ready at revision
      //      4 — and A observes that and returns FIRST.
      a[0].flush(feed([ticket({ fulfilment_status: 'ready',
                               fulfilment_revision: 4 })]));
      expect(activeIds()).withContext('A is authoritative and newer').toEqual([ID]);
      expect(completedIds()).toEqual([]);

      // 6. B returns the OLDER served/revision-3 snapshot it observed at step 3.
      //    Its request sequence is greater, which is the only thing the merge
      //    used to consult.
      b[0].flush(feed([ticket({ fulfilment_status: 'served', order_status: 'served',
                               served_at: new Date().toISOString(),
                               fulfilment_revision: 3 })]));

      expect(activeIds())
        .withContext('revision 4 is the newest SERVER state; it must stand')
        .toEqual([ID]);
      expect(activeRev()).toBe(4);
      expect(completedIds())
        .withContext('an older server snapshot may not relocate a ticket')
        .toEqual([]);
    });

    it('cannot move a ticket back onto Active at a superseded revision', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);

      // Completed read starts first this time; Active read second.
      service.loadCompleted().subscribe({ error: () => undefined });
      service.loadActive().subscribe({ error: () => undefined });
      const c = openCompleted();
      const a = openActive();

      c[0].flush(feed([ticket({ fulfilment_status: 'served', order_status: 'served',
                               served_at: new Date().toISOString(),
                               fulfilment_revision: 4 })]));
      expect(completedIds()).toEqual([ID]);
      expect(activeIds()).toEqual([]);

      a[0].flush(feed([ticket({ fulfilment_status: 'preparing',
                               fulfilment_revision: 3 })]));

      expect(completedIds()).toEqual([ID]);
      expect(completedRev()).toBe(4);
      expect(activeIds()).toEqual([]);
    });

    it('cannot resurrect an order a command removed from both boards', () => {
      // The revision floor has to survive the ticket leaving every store —
      // `find(id)` returning nothing is not the same as knowing nothing.
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.cancelOrder(ID, 'customer_request')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`).flush({
        status: 200, outcome: 'applied',
        data: state({ order_status: 'cancelled', fulfilment_status: 'preparing',
                      fulfilment_revision: 4,
                      cancelled_at: new Date().toISOString(),
                      cancellation_reason: 'customer_request' }),
      });
      expect(activeIds()).withContext('cancelled: gone from both').toEqual([]);
      expect(completedIds()).toEqual([]);

      // A read STARTED AFTER the cancel, carrying a snapshot the server took
      // BEFORE it. The tombstone is keyed on request sequence, so it does not
      // catch this one.
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);

      expect(activeIds())
        .withContext('revision 3 is behind the known revision 4')
        .toEqual([]);
    });

    it('eviction never drops a floor a just-removed order still needs', () => {
      // A SUCCESSFUL cancel leaves no operation and no card — only a tombstone
      // and a floor. The tombstone is spent by the very next read that omits
      // the order, so the floor is what has to survive the eviction that the
      // same read's arrivals trigger.
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.cancelOrder(ID, 'customer_request')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`).flush({
        status: 200, outcome: 'applied',
        data: state({ order_status: 'cancelled', fulfilment_status: 'preparing',
                      fulfilment_revision: 4,
                      cancelled_at: new Date().toISOString(),
                      cancellation_reason: 'customer_request' }),
      });
      expect(service.operationFor(ID))
        .withContext('a clean cancel leaves nothing behind to protect it')
        .toBeUndefined();

      // 900 arrivals in one read: eviction fires while this order is on no
      // board and carries no operation.
      seedActive(Array.from({ length: 900 }, (_, i) =>
        ticket({ id: `x-${i}`, fulfilment_revision: 1 })));

      // A snapshot the server took before the cancel. The tombstone was spent
      // by the read above, so only the floor can refuse this.
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(activeIds())
        .withContext('a cancelled order is not resurrected by eviction')
        .toEqual([]);
    });

    it('eviction never drops a floor an open question still needs', () => {
      // The other protected class, reached the way production reaches it: a
      // serve refused with `order_cancelled`. The refusal is authoritative, so
      // the ticket leaves both boards, and the notice stays as a detached
      // operation — which is the only thing marking this order as still in play.
      seedActive([ticket({ fulfilment_status: 'ready',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'served')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 409, reason: 'order_cancelled',
        message: 'This order was cancelled.',
        data: state({ order_status: 'cancelled', fulfilment_status: 'ready',
                      fulfilment_revision: 6,
                      cancelled_at: new Date().toISOString(),
                      cancellation_reason: 'customer_request' }),
      }, { status: 409, statusText: 'Conflict' });
      expect(activeIds()).toEqual([]);
      expect(service.operationFor(ID)?.phase).toBe('conflict');

      seedActive(Array.from({ length: 900 }, (_, i) =>
        ticket({ id: `x-${i}`, fulfilment_revision: 1 })));
      seedActive([]);

      seedActive([ticket({ fulfilment_status: 'ready',
                           fulfilment_revision: 3 })]);
      expect(activeIds())
        .withContext('the floor for an open question outlived the pressure')
        .toEqual([]);
      expect(service.operationFor(ID)?.phase).toBe('conflict');
    });

    it('DOCUMENTS THE BOUND: a settled order is eventually forgotten', () => {
      // NOT a defect and not a wish — this asserts the limit so it cannot be
      // read as a promise. The map is bounded, so an order that is settled, on
      // no board, carrying no operation and past its tombstone is forgotten
      // after hundreds of later orders, and a snapshot that old would then be
      // treated as new. Nothing that could still be outstanding is forgotten:
      // reads time out at 8s and commands at 15s, and 900 orders is a service.
      seedActive([ticket({ fulfilment_status: 'ready', fulfilment_revision: 9 })]);
      seedActive([]);                       // settled and off the board
      seedActive(Array.from({ length: 900 }, (_, i) =>
        ticket({ id: `x-${i}`, fulfilment_revision: 1 })));
      seedActive([]);

      seedActive([ticket({ fulfilment_status: 'new', fulfilment_revision: 1 })]);
      expect(activeIds())
        .withContext('forgotten, so an old snapshot reads as a new order')
        .toEqual([ID]);
    });

    it('absence from a feed is never read as a cancellation', () => {
      // A ticket can leave a feed for reasons that are not a cancellation, and
      // an unresolved cancel command must not be settled by one. The command
      // stays open and detached; nothing claims it landed.
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.cancelOrder(ID, 'customer_request')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`)
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.operationFor(ID)?.phase).toBe('unknown');

      seedActive([]);          // a genuinely later, genuinely empty read
      seedCompleted([]);

      const op = service.operationFor(ID)!;
      expect(op.phase)
        .withContext('an empty feed proves nothing about this command')
        .toBe('unknown');
      expect(op.detached).withContext('so its notice moves to the strip').toBeTrue();
      expect(op.message).not.toContain('cancelled');
      expect(service.unresolvedOperations().map(o => o.orderId)).toEqual([ID]);
    });

    it('CONTROL: a genuinely newer server revision is still applied', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      seedActive([ticket({ fulfilment_status: 'ready', fulfilment_revision: 4 })]);
      expect(activeRev()).toBe(4);
      expect(service.activeTickets()[0].fulfilment_status).toBe('ready');
    });

    it('CONTROL: a genuinely later EMPTY feed still removes membership', () => {
      seedActive([ticket({ fulfilment_revision: 3 })]);
      seedActive([]);
      expect(activeIds()).toEqual([]);
    });

    it('CONTROL: an unseen ticket still arrives, and a floor is per-order', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 7 })]);
      seedActive([
        ticket({ fulfilment_status: 'preparing', fulfilment_revision: 7 }),
        ticket({ id: 'k-02', fulfilment_revision: 0 }),
      ]);
      expect(activeIds().sort()).toEqual([ID, 'k-02']);
    });

    it('CONTROL: the same id is never on both boards at once', () => {
      seedCompleted([ticket({ fulfilment_status: 'served', order_status: 'served',
                              served_at: new Date().toISOString(),
                              fulfilment_revision: 3 })]);
      service.loadActive().subscribe({ error: () => undefined });
      service.loadCompleted().subscribe({ error: () => undefined });
      const a = openActive();
      const b = openCompleted();
      a[0].flush(feed([ticket({ fulfilment_status: 'ready',
                               fulfilment_revision: 4 })]));
      b[0].flush(feed([ticket({ fulfilment_status: 'served', order_status: 'served',
                               served_at: new Date().toISOString(),
                               fulfilment_revision: 3 })]));

      const both = activeIds().filter(id => completedIds().includes(id));
      expect(both).toEqual([]);
    });
  });

  // ── R1b: an authorised conflict is authoritative about membership too ──

  describe('R1b — an authorised conflict updates membership', () => {
    function conflict(body: any) {
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush(body, { status: 409, statusText: 'Conflict' });
    }

    it('takes a cancelled order off Active instead of repainting the card', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();

      conflict({
        status: 409, reason: 'order_cancelled',
        message: 'This order was cancelled.',
        data: state({ order_status: 'cancelled', fulfilment_status: 'preparing',
                      fulfilment_revision: 4,
                      cancelled_at: new Date().toISOString(),
                      cancellation_reason: 'customer_request' }),
      });

      expect(activeIds())
        .withContext('a cancelled order does not belong on the active board')
        .toEqual([]);
      expect(completedIds()).toEqual([]);

      const op = service.operationFor(ID);
      expect(op?.phase).withContext('the refusal is still stated').toBe('conflict');
      expect(op?.reason).toBe('order_cancelled');
      expect(service.unresolvedOperations().map(o => o.orderId))
        .withContext('its card is gone, so the notice needs a home')
        .toContain(ID);
    });

    it('moves a ticket off Completed when the conflict says it was recalled', () => {
      seedCompleted([ticket({ fulfilment_status: 'served', order_status: 'served',
                              served_at: new Date().toISOString(),
                              fulfilment_revision: 3 })]);
      expect(service.recallCompleted(ID)).toBeTrue();

      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({
          status: 409, reason: 'stale_revision',
          message: 'This ticket changed.',
          data: state({ fulfilment_status: 'ready', order_status: 'pending',
                        fulfilment_revision: 4, served_at: null }),
        }, { status: 409, statusText: 'Conflict' });

      expect(completedIds())
        .withContext('the server says it is ready, which is an ACTIVE state')
        .toEqual([]);
      expect(activeIds()).toEqual([ID]);
      expect(service.operationFor(ID)?.reason).toBe('stale_revision');
    });

    it('CONTROL: a non-terminal conflict keeps the ticket on its own board', () => {
      seedActive([ticket({ fulfilment_status: 'new', fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'preparing')).toBeTrue();

      conflict({
        status: 409, reason: 'stale_revision', message: 'This ticket changed.',
        data: state({ fulfilment_status: 'preparing', fulfilment_revision: 4 }),
      });

      expect(activeIds()).toEqual([ID]);
      expect(activeRev()).toBe(4);
      expect(service.activeTickets()[0].fulfilment_status).toBe('preparing');
      expect(service.operationFor(ID)?.phase).toBe('conflict');
      expect(service.operationFor(ID)?.detached)
        .withContext('its card is on screen; it is not detached')
        .toBeFalsy();
    });
  });

  // ── R2a: every mutation entry clears the same gate ───────────────────

  describe('R2a — retry applies the capability gate', () => {
    function unresolvedPriorityCommand(): void {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.setPriority(ID, true)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/priority/`)
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.operationFor(ID)?.phase).toBe('unknown');
    }

    it('sends nothing while the board is read-only, and keeps the command', () => {
      unresolvedPriorityCommand();

      // A server that declares no protocol: readable, and NOT commandable.
      service.loadActive().subscribe({ error: () => undefined });
      activeReq().flush(feed([ticket({ fulfilment_status: 'preparing',
                                       fulfilment_revision: 3 })], null));
      expect(service.canCommand()).toBeFalse();

      expect(service.retry(ID))
        .withContext('an exact replay is still a mutation')
        .toBeFalse();
      httpMock.expectNone(`${API}/kitchen/orders/${ID}/priority/`);

      const op = service.operationFor(ID);
      expect(op?.phase).withContext('retained, not discarded').toBe('unknown');
      expect(op?.command?.body).toEqual({ priority: true, if_revision: 3 });
    });

    it('CONTROL: once support returns, the exact bytes are replayed', () => {
      unresolvedPriorityCommand();
      service.loadActive().subscribe({ error: () => undefined });
      activeReq().flush(feed([ticket({ fulfilment_status: 'preparing',
                                       fulfilment_revision: 3 })], null));
      expect(service.retry(ID)).toBeFalse();

      // A protocol-declaring feed restores the capability.
      service.loadActive().subscribe({ error: () => undefined });
      activeReq().flush(feed([ticket({ fulfilment_status: 'preparing',
                                       fulfilment_revision: 3 })]));
      expect(service.canCommand()).toBeTrue();

      expect(service.retry(ID)).toBeTrue();
      const req = httpMock.expectOne(`${API}/kitchen/orders/${ID}/priority/`);
      expect(req.request.body)
        .withContext('the ORIGINAL precondition, never refreshed')
        .toEqual({ priority: true, if_revision: 3 });
    });
  });

  // ── R2b: one flight per order, and answers belong to their operation ──

  describe('R2b — single flight, and ownership of the answer', () => {
    function unresolved(): void {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.operationFor(ID)?.phase).toBe('unknown');
    }

    it('refuses a retry while a check for the same order is in flight', () => {
      unresolved();
      expect(service.reconcile(ID)).toBeTrue();
      expect(service.operationFor(ID)?.phase).toBe('checking');
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`);

      expect(service.retry(ID))
        .withContext('two recovery flights for one operation is the defect')
        .toBeFalse();
      httpMock.expectNone(`${API}/kitchen/orders/${ID}/fulfilment-status/`);
    });

    it('refuses a second check while one is in flight', () => {
      unresolved();
      expect(service.reconcile(ID)).toBeTrue();
      const open = httpMock.match(`${API}/kitchen/orders/${ID}/state/`);
      expect(open.length).toBe(1);

      expect(service.reconcile(ID)).toBeFalse();
      expect(httpMock.match(`${API}/kitchen/orders/${ID}/state/`).length)
        .withContext('no second read was opened')
        .toBe(0);
    });

    it('a failed check cannot downgrade a command issued after it', () => {
      // The reachable overlap: on the pre-fix service `retry()` accepted the
      // `checking` phase, so a read and a command were in flight together and
      // the read's error rewrote the command's record.
      unresolved();
      expect(service.reconcile(ID)).toBeTrue();
      const read = httpMock.match(`${API}/kitchen/orders/${ID}/state/`);
      expect(read.length).toBe(1);

      service.retry(ID);   // refused after the fix; allowed before it
      read[0].error(new ProgressEvent('error'));

      const op = service.operationFor(ID);
      expect(op).toBeDefined();
      expect(op!.phase)
        .withContext('a read that failed says nothing about a later command')
        .not.toBe('pending');
      // Whatever the phase, the retained command must survive intact.
      expect(op!.command?.body).toEqual({ action: 'advance', if_revision: 3 });
      expect(op!.ifRevision).toBe(3);
    });

    it('mints a fresh operation identity for every request', () => {
      unresolved();
      const first = service.operationFor(ID)!.owner!.opId;

      expect(service.reconcile(ID)).toBeTrue();
      const checking = service.operationFor(ID)!.owner!.opId;
      expect(checking)
        .withContext('the check is a different question from the command')
        .not.toBe(first);

      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`)
        .error(new ProgressEvent('error'));
      expect(service.operationFor(ID)?.phase).toBe('unknown');

      expect(service.retry(ID)).toBeTrue();
      const replay = service.operationFor(ID)!.owner!.opId;
      expect(replay).not.toBe(first);
      expect(replay).not.toBe(checking);
      // The precondition is NOT re-minted with the identity.
      expect(service.operationFor(ID)!.ifRevision).toBe(3);
    });

    it('DEFENCE IN DEPTH (source-level): a retired request cannot write', () => {
      // HONEST LABEL: this interleaving is CONSTRUCTED, not reached. Every
      // production path that retires a question also tears its subscription
      // down — `timeout()` unsubscribes, which aborts the XHR — and the
      // single-flight rules above stop a second one starting. The identity
      // check is what makes that a property of the code rather than of which
      // operators happen to be in the pipe today, so it is exercised by
      // calling the callback with a retired owner.
      unresolved();
      const retired = service.operationFor(ID)!.owner!;
      expect(service.reconcile(ID)).toBeTrue();
      const live = service.operationFor(ID)!.owner!;
      expect(live.opId).not.toBe(retired.opId);

      (service as any).resolveFailure(
        ID, retired, { status: 500 }, 'Moving to ready');
      expect(service.operationFor(ID)!.phase)
        .withContext('the outstanding check still owns the question')
        .toBe('checking');

      (service as any).leaveUnresolved(ID, retired);
      expect(service.operationFor(ID)!.phase).toBe('checking');

      // And the live one still settles it.
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`)
        .error(new ProgressEvent('error'));
      expect(service.operationFor(ID)!.phase).toBe('unknown');
    });

    it('CONTROL: independent orders keep their own flights', () => {
      seedActive([
        ticket({ fulfilment_status: 'preparing', fulfilment_revision: 3 }),
        ticket({ id: 'k-02', fulfilment_status: 'preparing',
                 fulfilment_revision: 5 }),
      ]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });

      expect(service.reconcile(ID)).toBeTrue();
      expect(service.advanceStatus('k-02', 'ready'))
        .withContext('a check on one order must not freeze the board')
        .toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/k-02/fulfilment-status/`);
    });
  });

  // ── R2c: an unchanged read is not proof of non-arrival ───────────────

  describe('R2c — what an unchanged observation may claim', () => {
    it('does not report a held-but-uncommitted command as never arriving', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });

      expect(service.reconcile(ID)).toBeTrue();
      // The read takes no lock, so this is exactly what an in-progress command
      // looks like from outside it.
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`).flush({
        status: 200,
        data: state({ fulfilment_status: 'preparing', fulfilment_revision: 3 }),
      });

      const op = service.operationFor(ID);
      expect(op?.phase)
        .withContext('still open — the read settled nothing')
        .toBe('unknown');
      expect(op?.message ?? '')
        .withContext('the read cannot certify non-execution')
        .not.toContain('did not reach');
      expect(op?.command).withContext('still replayable').toBeDefined();
    });

    it('CONTROL: an observation past the precondition still resolves it', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });

      expect(service.reconcile(ID)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`).flush({
        status: 200,
        data: state({ fulfilment_status: 'ready', fulfilment_revision: 4 }),
      });

      expect(service.operationFor(ID))
        .withContext('it reached the target it asked for')
        .toBeUndefined();
      expect(service.activeTickets()[0].fulfilment_status).toBe('ready');
    });
  });

  // ── R3: the result is judged against the command that was issued ─────

  describe('R3 — a mutation result is validated against its command', () => {
    function pendingCancel(): void {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 0 })]);
      expect(service.cancelOrder(ID, 'customer_request')).toBeTrue();
    }
    const cancelReq = () =>
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`);

    it('refuses an "applied" that did not advance the revision', () => {
      pendingCancel();
      cancelReq().flush({
        status: 200, outcome: 'applied',
        data: state({ order_status: 'pending', fulfilment_revision: 0 }),
      });

      expect(service.operationFor(ID)?.phase)
        .withContext('applied means exactly one increment')
        .toBe('unknown');
      expect(service.activeTickets()[0].order_status).toBe('pending');
    });

    it('refuses an "unchanged" for a command that cannot be a no-write', () => {
      pendingCancel();
      cancelReq().flush({
        status: 200, outcome: 'unchanged',
        data: state({ order_status: 'pending', fulfilment_revision: 0 }),
      });

      expect(service.operationFor(ID)?.phase)
        .withContext('only priority has a no-write result')
        .toBe('unknown');
    });

    it('refuses an "applied" whose state is not what the command asked for', () => {
      seedActive([ticket({ fulfilment_status: 'new', fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'preparing')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 200, outcome: 'applied',
        data: state({ fulfilment_status: 'ready', fulfilment_revision: 4 }),
      });

      expect(service.operationFor(ID)?.phase)
        .withContext('advance to preparing cannot report ready')
        .toBe('unknown');
    });

    it('CONTROL: a well-formed applied result completes the command', () => {
      seedActive([ticket({ fulfilment_status: 'new', fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'preparing')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 200, outcome: 'applied',
        data: state({ fulfilment_status: 'preparing', fulfilment_revision: 4 }),
      });

      expect(service.operationFor(ID)).toBeUndefined();
      expect(service.activeTickets()[0].fulfilment_status).toBe('preparing');
    });

    it('CONTROL: the priority no-write result is accepted at its own revision',
       () => {
      seedActive([ticket({ fulfilment_status: 'preparing', priority: true,
                           fulfilment_revision: 3 })]);
      expect(service.setPriority(ID, true)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/priority/`).flush({
        status: 200, outcome: 'unchanged',
        data: state({ fulfilment_status: 'preparing', priority: true,
                      fulfilment_revision: 3 }),
      });

      expect(service.operationFor(ID))
        .withContext('a legitimate no-write is a completed command')
        .toBeUndefined();
    });

    it('resolves an authentic delayed result without rolling the board back',
       () => {
      seedActive([ticket({ fulfilment_status: 'new', fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'preparing')).toBeTrue();
      const cmd = httpMock.expectOne(
        `${API}/kitchen/orders/${ID}/fulfilment-status/`);

      // The board learns a newer revision while the command answer is in flight.
      seedActive([ticket({ fulfilment_status: 'ready', fulfilment_revision: 6 })]);
      expect(activeRev()).toBe(6);

      // The command's own answer is authentic for the question it was asked.
      cmd.flush({
        status: 200, outcome: 'applied',
        data: state({ fulfilment_status: 'preparing', fulfilment_revision: 4 }),
      });

      expect(service.operationFor(ID))
        .withContext('an authentic result resolves its own command')
        .toBeUndefined();
      expect(activeRev())
        .withContext('but it may not drag the board back to revision 4')
        .toBe(6);
      expect(service.activeTickets()[0].fulfilment_status).toBe('ready');
    });

    it('does not silently drop a conflict projection naming another order', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 409, reason: 'stale_revision', message: 'This ticket changed.',
        data: state({ id: 'k-99', fulfilment_revision: 9 }),
      }, { status: 409, statusText: 'Conflict' });

      const op = service.operationFor(ID);
      expect(op?.phase)
        .withContext('a contradictory correlation is not a clean refusal')
        .toBe('unknown');
      expect(op?.command)
        .withContext('and the retained command is not discarded with it')
        .toBeDefined();
    });

    it('CONTROL: a legitimate state-less refusal is still a refusal', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 403, reason: 'kitchen_forbidden',
        message: 'You cannot do that.',
      }, { status: 403, statusText: 'Forbidden' });

      const op = service.operationFor(ID);
      expect(op?.phase).toBe('conflict');
      expect(op?.reason).toBe('kitchen_forbidden');
    });

    it('does not read an error envelope on HTTP 200 as an observation', () => {
      seedActive([ticket({ fulfilment_status: 'preparing',
                           fulfilment_revision: 3 })]);
      expect(service.advanceStatus(ID, 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.reconcile(ID)).toBeTrue();

      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`).flush({
        status: 409, reason: 'kitchen_forbidden',
        data: state({ fulfilment_status: 'served', fulfilment_revision: 9 }),
      });

      expect(service.activeTickets()[0].fulfilment_status)
        .withContext('a refusal body is not authoritative state')
        .toBe('preparing');
      expect(service.operationFor(ID)?.phase).toBe('unknown');
    });
  });
});
