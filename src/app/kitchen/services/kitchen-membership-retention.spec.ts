/**
 * M1 / M2 — the two R1 cases PR #670 left open.
 *
 *   M1  A CANCELLED PROJECTION REMOVES THE ORDER FROM ACTIVE ONLY.
 *       `mergeState`'s terminal branch filters `_tickets` and then, for a
 *       cancellation, records a tombstone under a comment reading "Gone from
 *       both boards". Nothing ever filters `_completed`, so an order the server
 *       has cancelled goes on being displayed as a completed ticket, and
 *       `syncDetached` — which asks where the ticket IS — sees that surviving
 *       row and leaves the refusal attached to it.
 *
 *   M2  RETIRING PROTECTION DOES NOT RETIRE THE RESPONSE IT PROTECTED AGAINST.
 *       A later-started feed that omits a tombstoned id forgets the tombstone,
 *       and `evictKnown` may then drop that id's stamp and revision floor once
 *       it is on neither board and carries no operation. Neither step asks
 *       whether an OLDER read is still outstanding — and one Completed response
 *       full of previously served tickets supplies both the omission and the
 *       eviction pressure. When that older read lands it has nothing left to
 *       refuse it, and a cancelled order reappears.
 *
 * EVERYTHING HERE DRIVES THE REAL SERVICE through the real `ApiService` and
 * `HttpClient`. `HttpTestingController` supplies the independent START and
 * ARRIVAL barriers M2 needs: a read is opened when the spec calls the service
 * and answered when the spec flushes it, so "which read started first" and
 * "which answer arrived first" are set separately.
 *
 * `httpMock.verify()` is deliberately NOT called: M2's whole fixture is a read
 * left outstanding on purpose.
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

/** Served `minsAgo` minutes ago — inside the ten-minute server recall window. */
function served(minsAgo = 1, over: Partial<KitchenTicket> = {}): KitchenTicket {
  return ticket({
    fulfilment_status: 'served',
    order_status: 'served',
    served_at: new Date(Date.now() - minsAgo * 60_000).toISOString(),
    ...over,
  });
}

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

/** Pass `null` to omit the protocol declaration (an explicit `undefined` would
 *  trigger the default parameter and quietly build a DECLARING envelope). */
function feed(records: any[], protocol: number | null = 1) {
  const body: any = { status: 200, data: { records } };
  if (protocol !== null) body.kitchen_protocol = protocol;
  return body;
}

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

/** The projection the backend returns for the reviewed sequence: recalled to
 *  `ready` at 4, then cancelled by a manager at 5. The fulfilment axis keeps
 *  its last value and `served_at` is cleared — the contract's own shape. */
function cancelledAfterRecall() {
  return state({
    order_status: 'cancelled',
    fulfilment_status: 'ready',
    fulfilment_revision: 5,
    served_at: null,
    cancelled_at: new Date().toISOString(),
    cancellation_reason: 'customer_changed_mind',
  });
}

describe('D05 M1/M2 — cancelled membership and safe metadata retirement', () => {
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
  const onNeitherBoard = () =>
    !activeIds().includes(ID) && !completedIds().includes(ID);

  // ── M1: cancelled means absent from BOTH feeds ───────────────────────

  describe('M1 — a cancelled projection clears both boards', () => {
    /** Device A's stale served card, recalled at the revision it still shows. */
    function staleRecallFromCompleted(): void {
      seedCompleted([served(1, { fulfilment_revision: 3 })]);
      expect(completedIds()).toEqual([ID]);
      expect(service.recallCompleted(ID))
        .withContext('a served ticket inside the window is recallable')
        .toBeTrue();
    }

    it('removes a cancelled order from Completed, not only from Active', () => {
      staleRecallFromCompleted();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush(
        {
          status: 409, reason: 'order_cancelled',
          message: 'This order was cancelled.',
          data: cancelledAfterRecall(),
        },
        { status: 409, statusText: 'Conflict' },
      );

      expect(completedIds())
        .withContext('a cancelled order is not a completed one')
        .not.toContain(ID);
      expect(activeIds()).not.toContain(ID);

      const op = service.operationFor(ID)!;
      expect(op.phase).withContext('the refusal stays definitive').toBe('conflict');
      expect(op.reason).toBe('order_cancelled');
      expect(op.message).toBe('This order was cancelled.');
      expect(op.detached)
        .withContext('its card has gone, so the notice moves to the strip')
        .toBeTrue();
      expect(service.unresolvedOperations().map(o => o.orderId)).toEqual([ID]);
    });

    it('handling that refusal issues no further command', () => {
      staleRecallFromCompleted();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush(
        {
          status: 409, reason: 'order_cancelled',
          message: 'This order was cancelled.',
          data: cancelledAfterRecall(),
        },
        { status: 409, statusText: 'Conflict' },
      );
      httpMock.expectNone(r => r.method !== 'GET');
    });

    it('the per-order observation path clears both boards too', () => {
      // A lost command leaves the question open; Check reads the order's state.
      seedCompleted([served(1, { fulfilment_revision: 3 })]);
      expect(service.recallCompleted(ID)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.operationFor(ID)?.phase).toBe('unknown');

      expect(service.reconcile(ID)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/state/`)
        .flush({ status: 200, kitchen_protocol: 1, data: cancelledAfterRecall() });

      expect(onNeitherBoard())
        .withContext('an observed cancellation is authoritative about membership')
        .toBeTrue();
      const op = service.operationFor(ID)!;
      expect(op.detached).toBeTrue();
      expect(op.message).toContain('cancelled');
    });

    it('CONTROL: a cancelled order on Active still leaves, as before', () => {
      seedActive([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 3 })]);
      expect(service.cancelOrder(ID, 'customer_changed_mind')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`).flush({
        status: 200, outcome: 'applied',
        data: state({
          order_status: 'cancelled', fulfilment_status: 'preparing',
          fulfilment_revision: 4, cancelled_at: new Date().toISOString(),
          cancellation_reason: 'customer_changed_mind',
        }),
      });
      expect(onNeitherBoard()).toBeTrue();
    });

    it('CONTROL: a legitimate recall to ready still moves Completed → Active', () => {
      staleRecallFromCompleted();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 200, outcome: 'applied',
        data: state({ fulfilment_status: 'ready', fulfilment_revision: 4 }),
      });
      expect(activeIds()).withContext('recalled onto the active board').toEqual([ID]);
      expect(completedIds()).toEqual([]);
    });

    it('CONTROL: an ordinary served ticket stays on Completed', () => {
      seedCompleted([served(1, { fulfilment_revision: 3 })]);
      seedCompleted([served(1, { fulfilment_revision: 4 })]);
      expect(completedIds()).toEqual([ID]);
      expect(activeIds()).toEqual([]);
    });

    it('CONTROL: an older cancelled projection is refused by the floor', () => {
      seedCompleted([served(1, { fulfilment_revision: 7 })]);
      expect(service.recallCompleted(ID)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush(
        {
          status: 409, reason: 'order_cancelled', message: 'This order was cancelled.',
          data: cancelledAfterRecall(),      // revision 5, behind the stored 7
        },
        { status: 409, statusText: 'Conflict' },
      );
      expect(completedIds())
        .withContext('a stale projection changes no membership')
        .toEqual([ID]);
      expect(service.completedTickets()[0].order_status).toBe('served');
    });
  });

  // ── M2: retiring protection must retire the response with it ─────────

  describe('M2 — an outstanding read cannot outlive its own protection', () => {
    /**
     * The reviewed schedule. `others` is how many previously served tickets the
     * Completed response carries — ordinary historical service data, not new
     * commands — and it is what decides whether the eviction sweep runs.
     */
    function scheduleWithOtherCompleted(others: number) {
      seedActive([ticket({ fulfilment_status: 'ready', fulfilment_revision: 3 })]);

      // (2) An Active read STARTS. Its response is held.
      service.loadActive().subscribe({ error: () => undefined });
      const held = openActive();
      expect(held.length).withContext('one outstanding Active read').toBe(1);

      // (3) The order is cancelled and the result applied. Tombstone + floor.
      expect(service.cancelOrder(ID, 'customer_changed_mind')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`).flush({
        status: 200, outcome: 'applied',
        data: state({
          order_status: 'cancelled', fulfilment_status: 'ready',
          fulfilment_revision: 4, cancelled_at: new Date().toISOString(),
          cancellation_reason: 'customer_changed_mind',
        }),
      });
      expect(onNeitherBoard()).toBeTrue();
      expect(service.operationFor(ID))
        .withContext('a clean cancel settles its own operation').toBeUndefined();

      // (4) ONE Completed read of historical service data: it omits the id, so
      //     the tombstone is forgotten, and it supplies the eviction pressure.
      seedCompleted(Array.from({ length: others }, (_, i) =>
        served(2, { id: `x-${i}`, fulfilment_revision: 1 })));

      return held;
    }

    it('CONTROL: below the cap, the order stays gone', () => {
      const held = scheduleWithOtherCompleted(499);
      held[0].flush(feed([ticket({ fulfilment_status: 'ready',
                                   fulfilment_revision: 3 })]));
      expect(activeIds())
        .withContext('the floor was never retired')
        .not.toContain(ID);
    });

    it('at the cap, the outstanding read cannot resurrect the cancelled order', () => {
      const held = scheduleWithOtherCompleted(500);
      held[0].flush(feed([ticket({ fulfilment_status: 'ready',
                                   fulfilment_revision: 3 })]));
      expect(activeIds())
        .withContext('retiring its protection must not authorise this response')
        .not.toContain(ID);
      expect(completedIds()).not.toContain(ID);
    });

    it('CONTROL: the protocol declaration was already fenced globally', () => {
      // Passes before this change too: `protocolSeq` is one number across both
      // feeds, so an older answer cannot republish a capability. Kept as the
      // control for the claim that a refused read gains NO authority of any
      // kind — this half of it was already true.
      const held = scheduleWithOtherCompleted(500);
      expect(service.canCommand()).toBeTrue();
      held[0].flush(feed([], null));          // an UNDECLARED envelope
      expect(service.canCommand()).toBeTrue();
    });

    /**
     * The reachable shape for an EVICTED floor, as opposed to a tombstoned one.
     *
     * A served order leaves the active board with no tombstone — it is a
     * completed ticket, not a removed one — and later ages out of the Completed
     * feed. Its entry is then on no board, carries no operation and has no
     * tombstone, so it is the one thing eviction may take. Its write happened
     * AFTER the held read began, which is exactly what made that read refusable
     * until the entry went.
     */
    function evictedFloorWhileReadOutstanding(): { held: any[] } {
      seedActive([
        ticket({ fulfilment_status: 'ready', fulfilment_revision: 3 }),
        ticket({ id: 'k-02', fulfilment_status: 'preparing',
                 fulfilment_revision: 3 }),
      ]);

      // An Active read STARTS and is held.
      service.loadActive().subscribe({ error: () => undefined });
      const held = openActive();
      expect(held.length).toBe(1);

      // O is served — written after the held read began, moved to Completed.
      expect(service.advanceStatus(ID, 'served')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush({
        status: 200, outcome: 'applied',
        data: state({
          fulfilment_status: 'served', order_status: 'served',
          fulfilment_revision: 4, served_at: new Date().toISOString(),
        }),
      });
      expect(completedIds()).toEqual([ID]);

      // One Completed read: O has aged out of the 24-hour window, and the
      // historical tickets it does carry are the eviction pressure.
      seedCompleted(Array.from({ length: 500 }, (_, i) =>
        served(2, { id: `x-${i}`, fulfilment_revision: 1 })));
      expect(completedIds()).not.toContain(ID);

      return { held };
    }

    it('an evicted floor does not authorise the read it was protecting', () => {
      const { held } = evictedFloorWhileReadOutstanding();
      held[0].flush(feed([ticket({ fulfilment_status: 'ready',
                                   fulfilment_revision: 3 })]));
      expect(activeIds())
        .withContext('a served order does not return to the active board')
        .not.toContain(ID);
    });

    it('a retired-out read gains no operation-settlement authority either', () => {
      // k-02 carries an open question. The retirement above is about a
      // DIFFERENT order — the watermark is one number for the board, because a
      // response that may not be applied may not be believed about anything.
      const { held } = evictedFloorWhileReadOutstanding();
      expect(service.advanceStatus('k-02', 'ready')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/k-02/fulfilment-status/`)
        .flush({}, { status: 500, statusText: 'Server Error' });
      expect(service.operationFor('k-02')?.phase).toBe('unknown');

      held[0].flush(feed([ticket({ id: 'k-02', fulfilment_status: 'ready',
                                   fulfilment_revision: 9 })]));
      expect(service.operationFor('k-02')?.phase)
        .withContext('a response this board refused cannot close a question')
        .toBe('unknown');
    });

    it('CONTROL: an ordinary cancellation does not retire a poll in flight', () => {
      // THE WATERMARK IS NARROW, and this pins that it stays narrow. Forgetting
      // a tombstone releases nothing an older read needed — the order's floor
      // and stamp are still standing — so the watermark does not move and a
      // poll that was in flight across a cancellation is still applied. Only an
      // actual eviction retires, which is what the two specs above exercise.
      // Written while checking whether the forget rule itself had to go: it did
      // not, and this is the evidence that leaving it costs nothing.
      seedActive([
        ticket({ fulfilment_status: 'ready', fulfilment_revision: 3 }),
        ticket({ id: 'k-02', fulfilment_status: 'new', fulfilment_revision: 1 }),
      ]);
      service.loadActive().subscribe({ error: () => undefined });
      const held = openActive();

      expect(service.cancelOrder(ID, 'customer_changed_mind')).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/cancel/`).flush({
        status: 200, outcome: 'applied',
        data: state({
          order_status: 'cancelled', fulfilment_status: 'ready',
          fulfilment_revision: 4, cancelled_at: new Date().toISOString(),
          cancellation_reason: 'customer_changed_mind',
        }),
      });
      seedCompleted([]);            // a later feed that omits the cancelled id

      held[0].flush(feed([
        ticket({ fulfilment_status: 'ready', fulfilment_revision: 3 }),
        ticket({ id: 'k-02', fulfilment_status: 'preparing',
                 fulfilment_revision: 2 }),
      ]));

      expect(activeIds())
        .withContext('the cancelled order stays gone — the tombstone said so')
        .not.toContain(ID);
      expect(service.activeTickets().find(t => t.id === 'k-02')?.fulfilment_status)
        .withContext('and the rest of that poll was still applied')
        .toBe('preparing');
    });

    it('CONTROL: a genuinely NEW read after retirement still works', () => {
      const held = scheduleWithOtherCompleted(500);
      held[0].flush(feed([ticket({ fulfilment_status: 'ready',
                                   fulfilment_revision: 3 })]));

      // Recovery must not be frozen: a read issued NOW is authoritative.
      seedActive([ticket({ id: 'k-99', fulfilment_status: 'new',
                           fulfilment_revision: 1 })]);
      expect(activeIds())
        .withContext('a fresh read still admits, updates and removes')
        .toEqual(['k-99']);
      expect(service.canCommand()).toBeTrue();
    });

    it('CONTROL: the Completed board is protected the same way', () => {
      seedCompleted([served(1, { fulfilment_revision: 3 })]);
      service.loadCompleted().subscribe({ error: () => undefined });
      const heldCompleted = httpMock.match(
        r => r.url.startsWith(`${API}/kitchen/orders/completed/`));
      expect(heldCompleted.length).toBe(1);

      expect(service.recallCompleted(ID)).toBeTrue();
      httpMock.expectOne(`${API}/kitchen/orders/${ID}/fulfilment-status/`).flush(
        {
          status: 409, reason: 'order_cancelled', message: 'This order was cancelled.',
          data: cancelledAfterRecall(),
        },
        { status: 409, statusText: 'Conflict' },
      );
      expect(onNeitherBoard()).toBeTrue();

      seedActive(Array.from({ length: 500 }, (_, i) =>
        ticket({ id: `y-${i}`, fulfilment_revision: 1 })));

      heldCompleted[0].flush(feed([served(1, { fulfilment_revision: 3 })]));
      expect(completedIds())
        .withContext('the cancelled order does not return to Completed either')
        .not.toContain(ID);
    });

    it('DOCUMENTS THE BOUND: memory is finite, and a NEW read still shows it', () => {
      // Finite memory is kept, and its cost is paid by a read issued AFTER the
      // retirement — never by one that was already outstanding when it happened.
      seedActive([ticket({ fulfilment_status: 'ready', fulfilment_revision: 9 })]);
      seedActive([]);
      seedCompleted(Array.from({ length: 600 }, (_, i) =>
        served(2, { id: `x-${i}`, fulfilment_revision: 1 })));

      seedActive([ticket({ fulfilment_status: 'new', fulfilment_revision: 1 })]);
      expect(activeIds())
        .withContext('forgotten, so a NEW read reads it as a new order')
        .toContain(ID);
    });
  });
});
