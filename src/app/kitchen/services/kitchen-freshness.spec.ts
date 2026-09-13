/**
 * K1 — ONE freshness and ownership policy across EVERY response path.
 *
 * The D05 review round closed ONE direction: `mergeState` refuses a command
 * projection older than the stored ticket. That left every OTHER writer
 * replacing state unconditionally, and the gap is not symmetric decoration —
 * each of these is a way for the board to show an operator something the server
 * stopped saying:
 *
 *   * `applyFeed` orders feeds against other READS only, then `store.set(...)`.
 *     A read issued before a command and answered after it reinstates the
 *     pre-command row, revision included.
 *   * A feed is a whole-store replacement, so a ticket the command path just
 *     moved to Completed comes back onto Active from a read taken before the
 *     move — the same id in two authoritative places.
 *   * `syncScope()` runs when a request STARTS. If the context changes and no
 *     further read begins, the generation never moves, so an answer captured
 *     under the old context still passes the generation check.
 *
 * These run the REAL service against controlled delivery, so the interleaving
 * is the one a slow network produces rather than a copied decision body.
 */

import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import { KitchenOrderService } from './kitchen-order.service';

describe('Kitchen freshness and ownership (K1)', () => {
  let service: KitchenOrderService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any; currentRestaurantRole: any;
                  user: Subject<any> };

  /** Queue of feed subjects, so a test decides exactly when a read answers. */
  let activeFeeds: Subject<any>[];
  let completedFeeds: Subject<any>[];
  let commandSubject: Subject<any>;

  function ticket(over: Partial<KitchenTicket> = {}): KitchenTicket {
    return {
      id: 'k-01',
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

  function feed(records: any[]) {
    return { status: 200, kitchen_protocol: 1, data: { records } };
  }

  /** The server's current-state projection for k-01. */
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

  beforeEach(() => {
    activeFeeds = [];
    completedFeeds = [];
    commandSubject = new Subject<any>();

    apiStub = {
      get: jasmine.createSpy('get').and.callFake((_: any, url: string) => {
        const s = new Subject<any>();
        if (url === 'kitchen/orders/completed/') completedFeeds.push(s);
        else activeFeeds.push(s);
        return s.asObservable();
      }),
      postPatch: jasmine.createSpy('postPatch')
        .and.callFake(() => commandSubject.asObservable()),
    };
    // `user` mirrors the real AuthenticationService, whose `user` is a
    // BehaviorSubject-backed Observable published on login, on token refresh and
    // on session replacement. It is the ONLY event this service can observe:
    // `currentRestaurantRole` is re-read from storage on every access and emits
    // nothing at all.
    authStub = {
      userValue: { profile: { id: 'u1', restaurant_roles: [] } },
      currentRestaurantRole: { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] },
      user: new Subject<any>(),
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

  /** Start a read and answer it immediately — the ordinary settled case. */
  function settleActive(records: any[]): void {
    service.loadActive().subscribe({ error: () => undefined });
    const s = activeFeeds[activeFeeds.length - 1];
    s.next(feed(records));
    s.complete();
  }

  function settleCompleted(records: any[]): void {
    service.loadCompleted().subscribe({ error: () => undefined });
    const s = completedFeeds[completedFeeds.length - 1];
    s.next(feed(records));
    s.complete();
  }

  /** Start a read WITHOUT answering it; returns the handle to answer later. */
  function openActive(): Subject<any> {
    service.loadActive().subscribe({ error: () => undefined });
    return activeFeeds[activeFeeds.length - 1];
  }

  function activeIds(): string[] { return service.activeTickets().map(t => t.id); }
  function completedIds(): string[] { return service.completedTickets().map(t => t.id); }
  function activeRevision(id: string): number | undefined {
    return service.activeTickets().find(t => t.id === id)?.fulfilment_revision;
  }

  // ── A delayed read must not undo a newer command result ─────────────

  it('does not let a feed taken before a command reinstate the pre-command row',
     () => {
    settleActive([ticket()]);              // revision 0, 'new'
    const stale = openActive();            // read starts BEFORE the command

    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    commandSubject.next(projection());     // server: revision 1, 'preparing'
    commandSubject.complete();
    expect(activeRevision('k-01')).toBe(1);

    // The older read now answers, still describing the pre-command row.
    stale.next(feed([ticket()]));
    stale.complete();

    expect(activeRevision('k-01'))
      .withContext('a read older than the command result must not be applied')
      .toBe(1);
    expect(service.activeTickets()[0].fulfilment_status).toBe('preparing');
  });

  it('does not let a delayed read undo an authorised conflict projection', () => {
    settleActive([ticket()]);
    const stale = openActive();

    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    commandSubject.error({
      status: 409,
      error: {
        status: 409, reason: 'kitchen_precondition_stale',
        message: 'This ticket changed since you loaded it.',
        data: {
          id: 'k-01', fulfilment_revision: 4, order_status: 'pending',
          fulfilment_status: 'ready', priority: false, served_at: null,
          cancelled_at: null, cancellation_reason: null,
        },
      },
    });
    expect(activeRevision('k-01')).toBe(4);

    stale.next(feed([ticket()]));
    stale.complete();

    expect(activeRevision('k-01'))
      .withContext('the conflict told us the truth; an older read cannot retract it')
      .toBe(4);
  });

  // ── Membership: a moved ticket must not be resurrected ──────────────

  it('does not resurrect a served ticket on Active from a read taken before the serve',
     () => {
    settleActive([ticket({ fulfilment_status: 'ready', fulfilment_revision: 2 })]);
    settleCompleted([]);
    const stale = openActive();            // taken while it was still active

    expect(service.advanceStatus('k-01', 'served')).toBeTrue();
    commandSubject.next(projection({
      fulfilment_revision: 3, fulfilment_status: 'served',
      order_status: 'served', served_at: new Date().toISOString(),
    }));
    commandSubject.complete();
    expect(activeIds()).toEqual([]);
    expect(completedIds()).toEqual(['k-01']);

    stale.next(feed([ticket({ fulfilment_status: 'ready', fulfilment_revision: 2 })]));
    stale.complete();

    expect(activeIds())
      .withContext('a served ticket must not reappear on Active')
      .toEqual([]);
    expect(completedIds()).toEqual(['k-01']);
  });

  it('does not resurrect a cancelled ticket from a read taken before the cancel',
     () => {
    settleActive([ticket()]);
    const stale = openActive();

    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    commandSubject.next(projection({
      fulfilment_revision: 1, order_status: 'cancelled',
      cancelled_at: new Date().toISOString(), cancellation_reason: 'customer_request',
    }));
    commandSubject.complete();
    expect(activeIds()).toEqual([]);

    stale.next(feed([ticket()]));
    stale.complete();

    expect(activeIds())
      .withContext('a cancelled ticket must not come back onto the board')
      .toEqual([]);
  });

  it('does not let a stale Completed read undo a recall', () => {
    settleActive([]);
    settleCompleted([ticket({
      fulfilment_status: 'served', order_status: 'served',
      served_at: new Date(Date.now() - 60_000).toISOString(), fulfilment_revision: 5,
    })]);
    service.loadCompleted().subscribe({ error: () => undefined });
    const staleCompleted = completedFeeds[completedFeeds.length - 1];

    expect(service.recallCompleted('k-01')).toBeTrue();
    commandSubject.next(projection({
      fulfilment_revision: 6, fulfilment_status: 'ready',
      order_status: 'pending', served_at: null,
    }));
    commandSubject.complete();
    expect(activeIds()).toEqual(['k-01']);
    expect(completedIds()).toEqual([]);

    staleCompleted.next(feed([ticket({
      fulfilment_status: 'served', order_status: 'served',
      served_at: new Date(Date.now() - 60_000).toISOString(), fulfilment_revision: 5,
    })]));
    staleCompleted.complete();

    expect(completedIds())
      .withContext('the recall already moved it off Completed')
      .toEqual([]);
    expect(activeIds()).toEqual(['k-01']);
  });

  // ── Emptiness: stale vs genuinely later ─────────────────────────────

  it('does not let a stale EMPTY read erase a ticket the command path just confirmed',
     () => {
    settleActive([ticket()]);
    const staleEmpty = openActive();

    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    commandSubject.next(projection());
    commandSubject.complete();

    staleEmpty.next(feed([]));
    staleEmpty.complete();

    expect(activeIds())
      .withContext('an empty read older than the command cannot retire the ticket')
      .toEqual(['k-01']);
  });

  it('DOES remove an obsolete ticket on a genuinely later empty read', () => {
    settleActive([ticket()]);
    expect(activeIds()).toEqual(['k-01']);

    settleActive([]);   // a later read, legitimately empty

    expect(activeIds())
      .withContext('the board must not become an unbounded cache')
      .toEqual([]);
  });

  /**
   * A FEED IS A STATEMENT ABOUT A SET, so an older read is not authoritative
   * about membership even for tickets no command has touched. The per-ticket
   * stamp alone cannot express that: a ticket the newest read never mentioned
   * carries no newer stamp, so a stale read would have been free to retire it.
   */
  it('does not let a stale read remove a ticket the newest read established',
     () => {
    settleActive([ticket({ id: 'k-01' }), ticket({ id: 'k-02', order_number: 2 })]);
    const stale = openActive();               // begins now…
    settleActive([ticket({ id: 'k-01' }), ticket({ id: 'k-02', order_number: 2 })]);

    stale.next(feed([ticket({ id: 'k-01' })]));   // …and answers late, missing k-02
    stale.complete();

    expect(activeIds().sort())
      .withContext('an older read cannot retire what a newer one listed')
      .toEqual(['k-01', 'k-02']);
  });

  it('does not let a stale read admit a ticket the newest read omitted', () => {
    settleActive([ticket({ id: 'k-01' })]);
    const stale = openActive();
    settleActive([ticket({ id: 'k-01' })]);

    stale.next(feed([ticket({ id: 'k-01' }), ticket({ id: 'k-99', order_number: 99 })]));
    stale.complete();

    expect(activeIds())
      .withContext('the newer read spoke about the whole set and did not list it')
      .toEqual(['k-01']);
  });

  /**
   * The protocol declaration is a claim about what the server can do NOW, so a
   * delayed older answer must not flip a commandable board read-only. An
   * UNREADABLE answer is deliberately not gated the same way: it really did
   * arrive, whenever it was asked for.
   */
  it('does not let a stale read lower the declared protocol', () => {
    settleActive([ticket()]);
    expect(service.canCommand()).toBeTrue();

    const stale = openActive();
    settleActive([ticket()]);

    // A response with no declaration at all — silence, which means 0.
    stale.next({ status: 200, data: { records: [ticket()] } });
    stale.complete();

    expect(service.canCommand())
      .withContext('an older answer does not un-declare a capability')
      .toBeTrue();
  });

  // ── Ownership: the live context, not the last one a read observed ────

  it('discards a feed captured before the restaurant changed, with no read between',
     () => {
    settleActive([ticket()]);
    const stale = openActive();

    // The operator switches restaurant. No further read begins.
    authStub.currentRestaurantRole =
      { restaurant_id: 'r2', restaurant: 'R2', roles: ['kitchen'] };

    stale.next(feed([ticket({ id: 'k-99' })]));
    stale.complete();

    expect(activeIds())
      .withContext("r1's answer must never populate r2's board")
      .not.toContain('k-99');
  });

  it('discards a command result captured before the restaurant changed', () => {
    settleActive([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    authStub.currentRestaurantRole =
      { restaurant_id: 'r2', restaurant: 'R2', roles: ['kitchen'] };

    commandSubject.next(projection());
    commandSubject.complete();

    expect(activeIds())
      .withContext("r1's command result must not land on r2's board")
      .toEqual([]);
  });

  it('refuses to issue a command after the context changed with no read between',
     () => {
    settleActive([ticket()]);

    authStub.currentRestaurantRole =
      { restaurant_id: 'r2', restaurant: 'R2', roles: ['kitchen'] };

    expect(service.advanceStatus('k-01', 'preparing'))
      .withContext('the cached ticket belongs to a restaurant we have left')
      .toBeFalse();
    expect(apiStub.postPatch).not.toHaveBeenCalled();
  });

  it('discards an answer captured before the operator changed', () => {
    settleActive([ticket()]);
    const stale = openActive();

    authStub.userValue = { profile: { id: 'u2', restaurant_roles: [] } };

    stale.next(feed([ticket({ id: 'k-77' })]));
    stale.complete();

    expect(activeIds())
      .withContext("one operator's answer must not populate another's board")
      .not.toContain('k-77');
  });

  it('invalidates the board the moment a different principal is PUBLISHED, '
     + 'with no read in between', () => {
    settleActive([ticket()]);
    expect(activeIds()).toEqual(['k-01']);

    // What the real service emits when one operator replaces another
    // (`installAuthenticatedSessionAndReload`) or a session is seated.
    authStub.userValue = { profile: { id: 'u2', restaurant_roles: [] } };
    authStub.currentRestaurantRole =
      { restaurant_id: 'r9', restaurant: 'R9', roles: ['kitchen'] };
    authStub.user.next(authStub.userValue);

    expect(activeIds())
      .withContext('a replaced principal must not inherit the previous board')
      .toEqual([]);
  });

  /**
   * THE HONEST LIMIT, stated rather than implied.
   *
   * A restaurant switch publishes NOTHING — `currentRestaurantRole` is read from
   * `rest_role` in storage on every access — and sign-out ends in a full page
   * load rather than an emission. So there is no event to observe for either,
   * and a synchronous store invalidation with no event and no read is not
   * something this service can promise.
   *
   * What it DOES promise is that nothing acts on the stale context: the next
   * thing that touches the service re-scopes, and a COMMAND — the only
   * consequential action — is refused outright rather than issued against the
   * board the operator has left. The board polls every 3s, so the display
   * catches up within one poll.
   */
  it('re-scopes on the next thing that touches it, and refuses to command '
     + 'from a board the operator has left', () => {
    settleActive([ticket()]);
    expect(activeIds()).toEqual(['k-01']);

    authStub.currentRestaurantRole =
      { restaurant_id: 'r2', restaurant: 'R2', roles: ['kitchen'] };

    // No event fired, so the store is momentarily stale — and a command is
    // still refused, because issuing re-reads the live context first.
    expect(service.advanceStatus('k-01', 'preparing'))
      .withContext('a command must never be issued from a stale context')
      .toBeFalse();
    expect(apiStub.postPatch).not.toHaveBeenCalled();
    expect(activeIds())
      .withContext('and that re-scope also clears what the old context held')
      .toEqual([]);
  });

  it('treats a same-principal return (A -> B -> A) as a new context', () => {
    settleActive([ticket()]);

    authStub.currentRestaurantRole =
      { restaurant_id: 'r2', restaurant: 'R2', roles: ['kitchen'] };
    const staleFromR1 = openActive();       // begins under r2, so it is r2's
    staleFromR1.complete();

    authStub.currentRestaurantRole =
      { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] };

    expect(activeIds())
      .withContext('returning to r1 must not resurrect the pre-switch board')
      .toEqual([]);
  });

  it('does not treat an ordinary token refresh as a context replacement', () => {
    settleActive([ticket()]);
    expect(activeIds()).toEqual(['k-01']);

    // Same principal, same membership — only the token material moved.
    authStub.userValue = {
      profile: { id: 'u1', restaurant_roles: [] },
      token: 'refreshed-access-token',
    };

    expect(activeIds())
      .withContext('a refresh is not a new operator; the board must survive it')
      .toEqual(['k-01']);
  });

  // ── One id, one authoritative store ─────────────────────────────────

  it('never shows the same id on both boards after any interleaving', () => {
    settleActive([ticket()]);
    settleCompleted([]);
    const stale = openActive();

    expect(service.advanceStatus('k-01', 'served')).toBeFalse();  // illegal jump
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    commandSubject.next(projection());
    commandSubject.complete();

    stale.next(feed([ticket()]));
    stale.complete();

    const overlap = activeIds().filter(id => completedIds().includes(id));
    expect(overlap).withContext('an id must live in exactly one store').toEqual([]);
  });
});
