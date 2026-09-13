/**
 * K2 — an uncertain command must actually be reconciled.
 *
 * D05 introduced the honest THREE-WAY outcome (pending / conflict / unknown)
 * and stopped rolling back on failure. What it did not build is the second
 * half: nothing ever RESOLVES an unknown. The consequences are all reachable:
 *
 *   * `applyFeed` never touches `_operations`, so a later read can show the
 *     command plainly succeeded while its warning sits there indefinitely.
 *   * A lost CANCELLATION is worse: the order leaves both feeds, the card goes
 *     with it, and the notice renders only inside a card — so the one outcome a
 *     cook most needs to see is the one that disappears.
 *   * `acknowledge()` deletes an `unknown` operation outright, so OK silently
 *     means "forget that the server may have acted".
 *   * `issue()` blocks only `pending`, so a fresh command at a refreshed
 *     revision quietly replaces an unresolved one — a different question asked
 *     as though it were the same.
 *   * `TicketOperation` keeps a label and a revision, but not the action, the
 *     route, the requested values or the context it was issued under, so there
 *     is nothing to re-send even in principle.
 *
 * The reconciliation read is the one new surface: neither feed can answer for a
 * cancelled order, because a cancelled order is in neither.
 */

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import { KitchenOrderService } from './kitchen-order.service';

describe('Kitchen uncertain-command reconciliation (K2)', () => {
  let service: KitchenOrderService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any; currentRestaurantRole: any };
  let activeFeeds: Subject<any>[];
  let stateReads: { url: string; subject: Subject<any> }[];
  let commands: { url: string; body: any; subject: Subject<any> }[];

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

  function state(over: Partial<any> = {}) {
    return {
      id: 'k-01', fulfilment_revision: 1, order_status: 'pending',
      fulfilment_status: 'preparing', priority: false, served_at: null,
      cancelled_at: null, cancellation_reason: null, ...over,
    };
  }

  beforeEach(() => {
    activeFeeds = [];
    stateReads = [];
    commands = [];
    apiStub = {
      get: jasmine.createSpy('get').and.callFake((_: any, url: string) => {
        const s = new Subject<any>();
        if (url.startsWith('kitchen/orders/') && !url.endsWith('active/')
            && !url.endsWith('completed/')) {
          stateReads.push({ url, subject: s });
        } else {
          activeFeeds.push(s);
        }
        return s.asObservable();
      }),
      postPatch: jasmine.createSpy('postPatch')
        .and.callFake((url: string, body: any) => {
          const s = new Subject<any>();
          commands.push({ url, body, subject: s });
          return s.asObservable();
        }),
    };
    authStub = {
      userValue: { profile: { id: 'u1', restaurant_roles: [] } },
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

  function settle(records: any[]): void {
    service.loadActive().subscribe({ error: () => undefined });
    const s = activeFeeds[activeFeeds.length - 1];
    s.next(feed(records));
    s.complete();
  }

  /** Issue a command and destroy the reply — the server may well have acted. */
  function loseTheReply(): void {
    const c = commands[commands.length - 1];
    c.subject.error({ status: 0, statusText: 'Unknown Error' });
  }

  // ── An ordinary read must settle an uncertain command ──────────────

  it('resolves an unknown operation once a later read shows the command landed',
     () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();
    expect(service.operationFor('k-01')?.phase).toBe('unknown');

    // The next poll shows the server DID apply it: revision moved past the
    // precondition and the status is what was asked for.
    settle([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 1 })]);

    expect(service.operationFor('k-01'))
      .withContext('an ordinary read that answers the question must clear it')
      .toBeUndefined();
  });

  it('keeps the operation unresolved when a later read cannot answer it', () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();

    // The row has not moved: this read settles nothing either way.
    settle([ticket()]);

    expect(service.operationFor('k-01')?.phase)
      .withContext('an unchanged row is not evidence that nothing happened')
      .toBe('unknown');
  });

  // ── A lost cancellation leaves both feeds ──────────────────────────

  it('keeps an actionable record when the order leaves both feeds', () => {
    settle([ticket()]);
    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    loseTheReply();

    settle([]);  // cancelled orders appear in neither feed

    expect(service.unresolvedOperations().map(o => o.orderId))
      .withContext('the warning must survive the card it was attached to')
      .toEqual(['k-01']);
  });

  it('reconciles a vanished order through the per-order state read', () => {
    settle([ticket()]);
    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    loseTheReply();
    settle([]);

    service.reconcile('k-01');
    expect(stateReads.length).withContext('one narrow read, not a sweep').toBe(1);
    expect(stateReads[0].url).toBe('kitchen/orders/k-01/state/');

    stateReads[0].subject.next({ status: 200, data: state({
      fulfilment_revision: 1, order_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: 'customer_request',
    }) });
    stateReads[0].subject.complete();

    expect(service.unresolvedOperations())
      .withContext('an authoritative observation settles it')
      .toEqual([]);
  });

  /**
   * WHEN THE OBSERVED STATE SATISFIES THE REQUEST there is nothing left to do,
   * so the notice is cleared (above). This is the OTHER branch: the revision has
   * moved, so SOME command was applied — but not to the state this one asked
   * for. That is genuinely unresolved-but-known, and the sentence must say what
   * the order IS without asserting which command put it there.
   */
  it('describes current state without claiming the earlier command caused it',
     () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();
    settle([]);   // somebody served it; it is on neither active feed row now

    service.reconcile('k-01');
    stateReads[0].subject.next({ status: 200, data: state({
      fulfilment_revision: 9, fulfilment_status: 'served',
      order_status: 'served', served_at: new Date().toISOString(),
    }) });
    stateReads[0].subject.complete();

    const resolved = service.resolvedNoticeFor('k-01');
    expect(resolved).withContext('the operator is told the outcome').toBeTruthy();
    expect(resolved!.toLowerCase())
      .withContext('state, not fabricated causality')
      .toContain('served');
    for (const causal of ['your command', 'was applied', 'succeeded', 'went through']) {
      expect(resolved!.toLowerCase())
        .withContext(`an observation carries no causal claim (${causal})`)
        .not.toContain(causal);
    }
  });

  /**
   * The matching branch stated explicitly, so the two cannot be confused: the
   * order reached exactly what was asked for, so the operation is CLEARED —
   * which is a statement that nothing remains to do, not a claim about cause.
   */
  it('clears the operation when the observed state is the one requested', () => {
    settle([ticket()]);
    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    loseTheReply();
    settle([]);

    service.reconcile('k-01');
    stateReads[0].subject.next({ status: 200, data: state({
      fulfilment_revision: 9, order_status: 'cancelled',
      cancelled_at: new Date().toISOString(), cancellation_reason: 'out_of_stock',
    }) });
    stateReads[0].subject.complete();

    expect(service.operationFor('k-01'))
      .withContext('the order is cancelled, which is what was asked for')
      .toBeUndefined();
  });

  /**
   * THE ONE INFERENCE THE REVISION SUPPORTS, in the direction that is safe.
   * A revision at or below the precondition means no command has been applied
   * since this one was formed, so this one certainly did not land.
   */
  it('reports a command as not landed when the revision has not moved', () => {
    settle([ticket({ fulfilment_revision: 3 })]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();

    service.reconcile('k-01');
    stateReads[0].subject.next({ status: 200, data: state({
      fulfilment_revision: 3, fulfilment_status: 'new',
    }) });
    stateReads[0].subject.complete();

    const op = service.operationFor('k-01')!;
    expect(op.phase)
      .withContext('nothing has been applied, so the command is re-sendable')
      .toBe('unknown');
    expect(service.retry('k-01')).toBeTrue();
    expect(commands[commands.length - 1].body.if_revision)
      .withContext('and the replay still carries the ORIGINAL precondition')
      .toBe(3);
  });

  it('does not treat a failed reconciliation read as proof of anything', () => {
    settle([ticket()]);
    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    loseTheReply();
    settle([]);

    service.reconcile('k-01');
    stateReads[0].subject.error({ status: 0, statusText: 'Unknown Error' });

    expect(service.unresolvedOperations().map(o => o.orderId))
      .withContext('an unreachable server proves neither execution nor absence')
      .toEqual(['k-01']);
  });

  it('does not treat a 404 from the reconciliation read as non-execution', () => {
    settle([ticket()]);
    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    loseTheReply();
    settle([]);

    service.reconcile('k-01');
    stateReads[0].subject.error({ status: 404, error: { status: 404 } });

    expect(service.unresolvedOperations().map(o => o.orderId))
      .withContext('not found is not proof the cancellation did not run')
      .toEqual(['k-01']);
  });

  // ── The retained command ───────────────────────────────────────────

  it('retains the full command so an explicit retry re-sends it unchanged', () => {
    settle([ticket({ fulfilment_revision: 4 })]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    const original = commands[0];
    loseTheReply();

    service.retry('k-01');

    expect(commands.length).toBe(2);
    expect(commands[1].url)
      .withContext('the same route')
      .toBe(original.url);
    expect(commands[1].body)
      .withContext('the same values and the ORIGINAL precondition')
      .toEqual(original.body);
    expect(commands[1].body.if_revision).toBe(4);
  });

  it('refuses a different command while the first is unresolved', () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();

    settle([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 1 })]);
    // (that read resolves it — re-lose a command to get back to unresolved)
    expect(service.advanceStatus('k-01', 'ready')).toBeTrue();
    loseTheReply();
    expect(service.operationFor('k-01')?.phase).toBe('unknown');

    expect(service.setPriority('k-01', true))
      .withContext('a second question must not replace an unanswered one')
      .toBeFalse();
    expect(service.cancelOrder('k-01', 'customer_request')).toBeFalse();
  });

  it('permits a genuine new decision after the uncertainty is settled', () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();
    settle([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 1 })]);
    expect(service.operationFor('k-01')).toBeUndefined();

    expect(service.advanceStatus('k-01', 'ready'))
      .withContext('fresh state, fresh decision — this is not a replay')
      .toBeTrue();
    expect(commands[commands.length - 1].body.if_revision)
      .withContext('the new command carries the CURRENT revision')
      .toBe(1);
  });

  // ── Dismissal is not abandonment ───────────────────────────────────

  it('does not let OK silently abandon unknown server work', () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();

    service.acknowledge('k-01');

    expect(service.operationFor('k-01'))
      .withContext('dismissing a warning must not discard the uncertainty')
      .toBeDefined();
  });

  it('does let OK dismiss a definitive conflict', () => {
    settle([ticket()]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    commands[0].subject.error({
      status: 409,
      error: { status: 409, reason: 'kitchen_precondition_stale', message: 'no',
               data: state({ fulfilment_revision: 7, fulfilment_status: 'ready' }) },
    });
    expect(service.operationFor('k-01')?.phase).toBe('conflict');

    service.acknowledge('k-01');

    expect(service.operationFor('k-01'))
      .withContext('a refusal the server stated is settled once it has been read')
      .toBeUndefined();
  });

  // ── An observation the board REFUSED settles nothing ───────────────

  /**
   * REPRODUCTION (Codex P1 on PR #669, valid). `mergeState` already refuses a
   * projection older than the stored ticket — the revision only ever increases,
   * so a lower one is definitionally stale. But `settleFromObservation` called
   * `settleAgainst` on that same projection regardless, so an answer the board
   * had just discarded as out of date was still allowed to close the question.
   *
   * It is the defect this whole change is about, reappearing on the one path
   * added to fix it.
   */
  it('does not settle an operation from a projection it refused as stale', () => {
    settle([ticket({ fulfilment_revision: 3 })]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();
    expect(service.operationFor('k-01')?.phase).toBe('unknown');

    service.reconcile('k-01');            // a state read is in flight…

    // …and a poll lands FIRST, carrying newer state.
    settle([ticket({ fulfilment_status: 'ready', fulfilment_revision: 7 })]);

    // Now the overtaken read arrives, describing the world at revision 6.
    stateReads[0].subject.next({ status: 200, data: state({
      fulfilment_revision: 6, fulfilment_status: 'preparing',
    }) });
    stateReads[0].subject.complete();

    expect(service.activeTickets()[0].fulfilment_revision)
      .withContext('the board keeps the newer state, as it already did')
      .toBe(7);
    expect(service.operationFor('k-01'))
      .withContext('an answer the board discarded cannot close the question')
      .toBeDefined();
  });

  it('still settles from an observation the board accepts', () => {
    // CONTROL: the fix must not make reconciliation inert.
    settle([ticket({ fulfilment_revision: 3 })]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();

    service.reconcile('k-01');
    stateReads[0].subject.next({ status: 200, data: state({
      fulfilment_revision: 4, fulfilment_status: 'preparing',
    }) });
    stateReads[0].subject.complete();

    expect(service.operationFor('k-01'))
      .withContext('the order reached what was asked for')
      .toBeUndefined();
  });

  // ── An advance is settled by ITS target, not by any forward state ──

  /**
   * REPRODUCTION (Codex P1 on PR #669, valid, and the sharpest of the four).
   * `matchesRequest` accepted `preparing` OR `ready` for an `advance`, so an
   * advance issued FROM `preparing` — whose target was specifically `ready` —
   * was "matched" by a ticket still sitting in `preparing`. Another device
   * bumping the revision with an unrelated PRIORITY change was then enough to
   * clear the operation, and the board reported a command that never landed as
   * having succeeded.
   *
   * The revision moving is evidence that SOME command applied. It was never
   * evidence that THIS one did — which is the rule `settleAgainst` states and
   * this predicate quietly broke.
   */
  it('does not treat another device\'s change as this advance landing', () => {
    settle([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 3 })]);
    expect(service.advanceStatus('k-01', 'ready')).toBeTrue();
    loseTheReply();
    expect(service.operationFor('k-01')?.phase).toBe('unknown');

    // Somebody else prioritises it. The revision moves; the ticket does not.
    settle([ticket({
      fulfilment_status: 'preparing', fulfilment_revision: 4, priority: true,
    })]);

    const op = service.operationFor('k-01');
    expect(op)
      .withContext('the advance to ready plainly did not happen')
      .toBeDefined();
    expect(op!.phase)
      .withContext('the state is known, the cause is not')
      .toBe('resolved');
    expect(service.resolvedNoticeFor('k-01')!.toLowerCase())
      .toContain('preparation');
  });

  it('clears an advance that reached its OWN target', () => {
    // CONTROL: exactness must not cost the ordinary case.
    settle([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 3 })]);
    expect(service.advanceStatus('k-01', 'ready')).toBeTrue();
    loseTheReply();

    settle([ticket({ fulfilment_status: 'ready', fulfilment_revision: 4 })]);

    expect(service.operationFor('k-01'))
      .withContext('it reached exactly what was asked for')
      .toBeUndefined();
  });

  it('clears a first advance that reached ITS target', () => {
    // CONTROL: new -> preparing, the other advance edge.
    settle([ticket({ fulfilment_status: 'new', fulfilment_revision: 3 })]);
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    loseTheReply();

    settle([ticket({ fulfilment_status: 'preparing', fulfilment_revision: 4 })]);

    expect(service.operationFor('k-01')).toBeUndefined();
  });

  // ── Bounded work ───────────────────────────────────────────────────

  it('bounds automatic reconciliation attempts', () => {
    settle([ticket()]);
    expect(service.cancelOrder('k-01', 'customer_request')).toBeTrue();
    loseTheReply();
    settle([]);

    for (let i = 0; i < 12; i++) {
      service.reconcile('k-01');
      const r = stateReads[stateReads.length - 1];
      if (r && !r.subject.closed) r.subject.error({ status: 0 });
    }

    expect(stateReads.length)
      .withContext('a failing recovery must not poll forever')
      .toBeLessThanOrEqual(6);
    expect(service.unresolvedOperations().map(o => o.orderId)).toEqual(['k-01']);
  });

  it('does not read every order on an ordinary poll', () => {
    settle([ticket(), ticket({ id: 'k-02' }), ticket({ id: 'k-03' })]);
    settle([ticket(), ticket({ id: 'k-02' }), ticket({ id: 'k-03' })]);

    expect(stateReads.length)
      .withContext('reconciliation is on demand, never an N+1 sweep')
      .toBe(0);
  });
});
