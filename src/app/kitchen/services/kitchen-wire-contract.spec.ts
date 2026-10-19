/**
 * K3 — validate the kitchen wire contract BEFORE acting on it.
 *
 * These are DEFENSIVE-CONTRACT tests. They are not evidence that today's
 * backend emits such payloads; they establish that a malformed or mis-addressed
 * answer cannot move the board, because the client currently believes anything
 * that is shaped roughly right:
 *
 *   * `extractTickets` casts any array, `[null]` included.
 *   * `kitchenProtocolOf` accepts any finite number, 1.5 included.
 *   * command eligibility asks only `typeof revision === 'number'`, which NaN
 *     and fractional and negative values all satisfy.
 *   * `resolveSuccess` clears the operation and merges any `data` carrying a
 *     numeric revision — it never checks that the answer is ABOUT the order it
 *     commanded, nor that `outcome` is a word the contract defines.
 *   * `resolveFailure` hands unvalidated `body.data` to the same merger.
 *
 * The mis-addressed case is the sharpest: a reply naming a DIFFERENT order was
 * applied to the commanded ticket and its pending operation was cleared, so the
 * board reported a success that the server never stated about that order.
 *
 * Part of this suite runs through the REAL HttpClient, interceptor chain and
 * ApiService, because a validator that only guards a stub is not in the path
 * the deployed app takes.
 */

import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { Subject } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import { KitchenOrderService } from './kitchen-order.service';
import { isCommandable, isValidRevision } from './kitchen-wire';

const API = `${environment.apiUrl}/api/${environment.version}`;

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

function feed(records: any[], over: Partial<any> = {}) {
  return { status: 200, kitchen_protocol: 1, data: { records }, ...over };
}

function state(over: Partial<any> = {}) {
  return {
    id: 'k-01', fulfilment_revision: 1, order_status: 'pending',
    fulfilment_status: 'preparing', priority: false, served_at: null,
    cancelled_at: null, cancellation_reason: null, ...over,
  };
}

// ── Stub-driven: the contract rules themselves ────────────────────────

describe('Kitchen wire contract (K3)', () => {
  let service: KitchenOrderService;
  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };
  let authStub: { userValue: any; currentRestaurantRole: any };
  let activeFeeds: Subject<any>[];
  let commandSubject: Subject<any>;

  beforeEach(() => {
    activeFeeds = [];
    commandSubject = new Subject<any>();
    apiStub = {
      get: jasmine.createSpy('get').and.callFake(() => {
        const s = new Subject<any>();
        activeFeeds.push(s);
        return s.asObservable();
      }),
      postPatch: jasmine.createSpy('postPatch')
        .and.callFake(() => commandSubject.asObservable()),
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

  function settle(body: any): void {
    service.loadActive().subscribe({ error: () => undefined });
    const s = activeFeeds[activeFeeds.length - 1];
    s.next(body);
    s.complete();
  }

  function activeIds(): string[] { return service.activeTickets().map(t => t.id); }

  // ── Feed item validation ──────────────────────────────────────────

  it('treats a feed containing a null ticket as unreadable, keeping the last board',
     () => {
    settle(feed([ticket()]));
    expect(activeIds()).toEqual(['k-01']);

    settle(feed([null]));

    expect(service.feedUnreadable())
      .withContext('[null] is not a readable board')
      .toBeTrue();
    expect(activeIds())
      .withContext('the last valid board is retained, not blanked')
      .toEqual(['k-01']);
  });

  it('treats a feed row missing its id as unreadable', () => {
    settle(feed([ticket()]));
    settle(feed([{ order_number: 2, fulfilment_status: 'new' }]));

    expect(service.feedUnreadable()).toBeTrue();
    expect(activeIds()).toEqual(['k-01']);
  });

  it('treats an unknown fulfilment_status as unreadable', () => {
    settle(feed([ticket()]));
    settle(feed([ticket({ fulfilment_status: 'incinerated' as any })]));

    expect(service.feedUnreadable()).toBeTrue();
    expect(activeIds()).toEqual(['k-01']);
  });

  it('treats duplicate ticket identities in one feed as unreadable', () => {
    settle(feed([ticket()]));
    settle(feed([ticket(), ticket()]));

    expect(service.feedUnreadable())
      .withContext('one id twice in one feed is not a board we can render')
      .toBeTrue();
    expect(activeIds()).toEqual(['k-01']);
  });

  it('treats malformed nested display content as unreadable rather than rendering it',
     () => {
    settle(feed([ticket()]));
    settle(feed([ticket({
      items: [{ item_name_snapshot: 'X', quantity: 1, modifiers: null,
                allergen_tags: [{ name: 'Nuts' }] } as any],
    })]));

    expect(service.feedUnreadable()).toBeTrue();
    expect(activeIds()).toEqual(['k-01']);
  });

  it('accepts a valid empty current feed as a real empty board', () => {
    settle(feed([ticket()]));
    settle(feed([]));

    expect(service.feedUnreadable()).toBeFalse();
    expect(activeIds()).toEqual([]);
  });

  // ── Capability representation ─────────────────────────────────────

  it('refuses a fractional protocol declaration', () => {
    settle(feed([ticket()], { kitchen_protocol: 1.5 }));
    expect(service.canCommand())
      .withContext('1.5 is not a protocol level this client speaks')
      .toBeFalse();
  });

  it('keeps a pre-D05 feed readable but read-only', () => {
    const legacy = { status: 200, data: { records: [
      { id: 'k-01', order_number: 1, table_label: 'T', order_source: 'diner_self_service',
        fulfilment_status: 'new', priority: false,
        created_at: new Date().toISOString(), served_at: null, items: [] },
    ] } };
    settle(legacy);

    expect(service.feedUnreadable())
      .withContext('an older server is not a broken one')
      .toBeFalse();
    expect(activeIds()).toEqual(['k-01']);
    expect(service.canCommand()).toBeFalse();
  });

  // ── Revision eligibility ──────────────────────────────────────────

  // A revision is a counter, so the only shapes that can serve as a
  // precondition are non-negative integers. `typeof x === 'number'` was the old
  // test and it admits all three of these, each of which would then be SENT
  // BACK as an `if_revision` the server can never match.
  //
  // Two halves, kept apart deliberately: a malformed row is refused by the FEED
  // reader (so it never reaches the store), and the eligibility predicate is
  // exercised directly. Asserting only "no command was issued" would pass for
  // the uninteresting reason that the ticket is absent.
  for (const [name, value] of
       [['NaN', NaN], ['fractional', 2.5], ['negative', -1]] as [string, number][]) {
    it(`refuses a feed row whose revision is ${name}, and commands nothing from it`,
       () => {
      settle(feed([ticket({ fulfilment_revision: value })]));

      expect(service.feedUnreadable())
        .withContext('a declared-protocol server sending an unusable revision '
                   + 'is a contract error, not an older server')
        .toBeTrue();
      expect(service.advanceStatus('k-01', 'preparing')).toBeFalse();
      expect(apiStub.postPatch).not.toHaveBeenCalled();
    });

    it(`treats a ${name} revision as non-commandable`, () => {
      expect(isValidRevision(value)).toBeFalse();
      expect(isCommandable(ticket({ fulfilment_revision: value }))).toBeFalse();
    });
  }

  it('treats a whole non-negative revision as commandable', () => {
    expect(isCommandable(ticket({ fulfilment_revision: 0 }))).toBeTrue();
    expect(isCommandable(ticket({ fulfilment_revision: 7 }))).toBeTrue();
    expect(isCommandable(ticket({ fulfilment_revision: undefined }))).toBeFalse();
  });

  it('does not let an unreadable feed disturb the last valid board', () => {
    settle(feed([ticket({ fulfilment_revision: 3 })]));
    settle(feed([ticket({ fulfilment_revision: 2.5 })]));

    expect(activeIds())
      .withContext('a contract error keeps the last valid content')
      .toEqual(['k-01']);
    expect(service.activeTickets()[0].fulfilment_revision)
      .withContext('and never adopts the unusable value')
      .toBe(3);
    expect(service.advanceStatus('k-01', 'preparing'))
      .withContext('the ticket it still holds is perfectly commandable')
      .toBeTrue();
  });

  /**
   * REPRODUCTION (Codex P2 on PR #669, valid). THE PROTOCOL DECLARATION IS A
   * PROMISE ABOUT THE ROWS, and the row rule did not read it. A feed claiming
   * `kitchen_protocol: 1` was accepted with `fulfilment_revision` missing,
   * because the field is validated only when present — so the board enabled
   * itself globally while every single click was refused by `isCommandable`,
   * with no notice of any kind. An operator presses Start and nothing happens.
   *
   * This is the file's own stated rule applied where it had not been: a server
   * that CLAIMS the protocol and then sends something the contract does not
   * define is a CONTRACT ERROR, not an older server.
   */
  it('refuses a declared-protocol feed whose rows omit the revision', () => {
    settle(feed([ticket({ fulfilment_revision: undefined })]));

    expect(service.feedUnreadable())
      .withContext('it promised a precondition and did not send one')
      .toBeTrue();
    expect(service.canCommand())
      .withContext('and nothing from that answer may enable the board')
      .toBeFalse();
  });

  it('keeps the board usable when SOME rows carry a revision', () => {
    // The refusal is about the whole answer, as every readFeed refusal is —
    // a feed this client cannot represent is not a board it can render half of.
    settle(feed([ticket(), ticket({ id: 'k-02', order_number: 2,
                                    fulfilment_revision: undefined })]));
    expect(service.feedUnreadable()).toBeTrue();
    expect(activeIds())
      .withContext('the last valid content is kept, not half the new one')
      .toEqual([]);
  });

  // ── Mutation outcome correlation ──────────────────────────────────

  it('refuses a success payload that names a DIFFERENT order', () => {
    settle(feed([ticket(), ticket({ id: 'k-02', order_number: 2 })]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    commandSubject.next({ status: 200, outcome: 'applied',
                          data: state({ id: 'k-99', fulfilment_revision: 5,
                                        fulfilment_status: 'ready' }) });
    commandSubject.complete();

    const t = service.activeTickets().find(x => x.id === 'k-01')!;
    expect(t.fulfilment_status)
      .withContext("another order's state must never be applied to this ticket")
      .toBe('new');
    expect(t.fulfilment_revision).toBe(0);
    expect(service.operationFor('k-01')?.phase)
      .withContext('an answer we cannot attribute does not resolve the command')
      .toBe('unknown');
  });

  it('refuses a success payload carrying an unknown outcome word', () => {
    settle(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    commandSubject.next({ status: 200, outcome: 'banana', data: state() });
    commandSubject.complete();

    expect(service.activeTickets()[0].fulfilment_status).toBe('new');
    expect(service.operationFor('k-01')?.phase).toBe('unknown');
  });

  it('refuses a success payload missing required state fields', () => {
    settle(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    commandSubject.next({ status: 200, outcome: 'applied',
                          data: { id: 'k-01', fulfilment_revision: 3 } });
    commandSubject.complete();

    const t = service.activeTickets()[0];
    expect(t.fulfilment_status)
      .withContext('a partial projection must not patch undefined over real values')
      .toBe('new');
    expect(t.order_status).toBe('pending');
    expect(service.operationFor('k-01')?.phase).toBe('unknown');
  });

  it('does not read an error envelope carried on HTTP 200 as applied success', () => {
    settle(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    commandSubject.next({ status: 409, reason: 'kitchen_precondition_stale',
                          message: 'stale', data: state({ fulfilment_revision: 9 }) });
    commandSubject.complete();

    expect(service.operationFor('k-01')?.phase)
      .withContext('a 409 envelope on a 200 transport is not a success')
      .not.toBe(undefined);
    expect(service.operationFor('k-01')?.phase).not.toBe('pending');
  });

  it('refuses a conflict payload that names a different order', () => {
    settle(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    commandSubject.error({
      status: 409,
      error: { status: 409, reason: 'kitchen_precondition_stale', message: 'no',
               data: state({ id: 'k-42', fulfilment_revision: 8,
                             fulfilment_status: 'served' }) },
    });

    const t = service.activeTickets()[0];
    expect(t.fulfilment_status)
      .withContext("a conflict about another order cannot move this one")
      .toBe('new');
  });

  it('still applies a well-formed conflict projection for the right order', () => {
    settle(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    commandSubject.error({
      status: 409,
      error: { status: 409, reason: 'kitchen_precondition_stale', message: 'no',
               data: state({ fulfilment_revision: 8, fulfilment_status: 'ready' }) },
    });

    expect(service.activeTickets()[0].fulfilment_status)
      .withContext('the control: a valid conflict is still authoritative')
      .toBe('ready');
    expect(service.operationFor('k-01')?.phase).toBe('conflict');
    expect(service.operationFor('k-01')?.reason).toBe('kitchen_precondition_stale');
  });
});

// ── Real HttpClient / interceptor / ApiService path ───────────────────

describe('Kitchen wire contract through the real HTTP path (K3)', () => {
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
              { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] },
          },
        },
      ],
    });
    service = TestBed.inject(KitchenOrderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushActive(body: any): void {
    service.loadActive().subscribe({ error: () => undefined });
    httpMock.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/active/`))
      .flush(body);
  }

  it('validates a malformed feed delivered through the real ApiService', () => {
    flushActive(feed([ticket()]));
    expect(service.activeTickets().map(t => t.id)).toEqual(['k-01']);

    flushActive(feed([null]));

    expect(service.feedUnreadable())
      .withContext('the validator must sit in the path the app actually uses')
      .toBeTrue();
    expect(service.activeTickets().map(t => t.id)).toEqual(['k-01']);
  });

  it('refuses a mis-addressed command reply delivered through the real ApiService',
     () => {
    flushActive(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    httpMock.expectOne(`${API}/kitchen/orders/k-01/fulfilment-status/`)
      .flush({ status: 200, outcome: 'applied',
               data: state({ id: 'k-99', fulfilment_revision: 6 }) });

    expect(service.activeTickets()[0].fulfilment_status).toBe('new');
    expect(service.operationFor('k-01')?.phase).toBe('unknown');
  });

  it('applies a well-formed command reply delivered through the real ApiService',
     () => {
    flushActive(feed([ticket()]));
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();

    httpMock.expectOne(`${API}/kitchen/orders/k-01/fulfilment-status/`)
      .flush({ status: 200, outcome: 'applied', data: state() });

    expect(service.activeTickets()[0].fulfilment_status)
      .withContext('the control: the ordinary path still works end to end')
      .toBe('preparing');
    expect(service.operationFor('k-01')).toBeUndefined();
  });
});

// ── D12 B3: the three line provenance markers, normalised independently ──

/**
 * The Backend publishes `item_name_provenance`, `modifiers_provenance` and
 * `allergen_tags_provenance` on every kitchen line and extra. The reader's
 * rule, per marker and per line, with no marker ever inferred from the values
 * beside it:
 *
 *   * ABSENT stays absent — an older server made no claim, so none is invented;
 *   * exactly `snapshot` or `missing` is kept;
 *   * anything else that is PRESENT (null, an unknown word, a number, an
 *     object…) becomes `missing`, and the feed stays readable — a marker is
 *     metadata about a value, and a broken one is a reason for caution, not for
 *     blanking a board the kitchen is working from.
 *
 * The existing required-field rules are untouched: a malformed name, quantity,
 * option list or allergen list still makes the whole feed unreadable.
 */
describe('Kitchen line provenance markers through the real HTTP path (D12 B3)', () => {
  let service: KitchenOrderService;
  let httpMock: HttpTestingController;

  const MARKERS = [
    'item_name_provenance', 'modifiers_provenance', 'allergen_tags_provenance',
  ] as const;
  const ABSENT = Symbol('absent');

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
              { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] },
          },
        },
      ],
    });
    service = TestBed.inject(KitchenOrderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value as any)) deepFreeze(child);
    }
    return value;
  }

  /** A captured line with one captured extra, every marker `snapshot`. */
  function line(): any {
    return {
      item_name_snapshot: 'Beef Burger', quantity: 2, modifiers: ['Size: Large'],
      allergen_tags: [{ name: 'Peanuts', icon: 'nut', colour: 'red' }],
      item_name_provenance: 'snapshot', modifiers_provenance: 'snapshot',
      allergen_tags_provenance: 'snapshot',
      extras: [{
        item_name_snapshot: 'Cheese Slice', quantity: 2, modifiers: [],
        allergen_tags: [{ name: 'Milk', icon: 'milk', colour: 'amber' }],
        item_name_provenance: 'snapshot', modifiers_provenance: 'snapshot',
        allergen_tags_provenance: 'snapshot',
      }],
    };
  }

  /** Deliver a body through the real path, frozen, and return its serialisation. */
  function flushActive(body: any): string {
    const sent = JSON.stringify(body);
    deepFreeze(body);
    service.loadActive().subscribe({ error: () => undefined });
    httpMock.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/active/`))
      .flush(body);
    return sent;
  }

  function held(): any {
    return service.activeTickets()[0].items[0];
  }

  const CASES: [string, unknown, 'snapshot' | 'missing' | 'absent'][] = [
    ['absent', ABSENT, 'absent'],
    ['exactly snapshot', 'snapshot', 'snapshot'],
    ['exactly missing', 'missing', 'missing'],
    ['null', null, 'missing'],
    ['an unknown word', 'unknown', 'missing'],
    ['a differently cased word', 'SNAPSHOT', 'missing'],
    ['an empty string', '', 'missing'],
    ['a number', 1, 'missing'],
    ['a boolean', true, 'missing'],
    ['an object', { snapshot: true }, 'missing'],
    ['an array', ['snapshot'], 'missing'],
  ];

  for (const where of ['parent', 'extra'] as const) {
    for (const marker of MARKERS) {
      for (const [label, value, expected] of CASES) {
        it(`reads ${marker} on the ${where} given ${label} as ${expected}`, () => {
          const l = line();
          const target = where === 'parent' ? l : l.extras[0];
          if (value === ABSENT) delete target[marker];
          else target[marker] = value;
          const body = feed([ticket({ items: [l], fulfilment_revision: 4 })]);
          const sent = flushActive(body);

          expect(service.feedUnreadable())
            .withContext('a marker alone never makes a feed unreadable')
            .toBeFalse();
          const h = held();
          const mine = where === 'parent' ? h : h.extras[0];
          if (expected === 'absent') {
            expect(marker in mine).withContext('no claim is invented').toBeFalse();
          } else {
            expect(mine[marker]).toBe(expected);
          }
          for (const sibling of MARKERS.filter(m => m !== marker)) {
            expect(mine[sibling]).withContext(`${sibling} is independent`).toBe('snapshot');
          }
          const other = where === 'parent' ? h.extras[0] : h;
          for (const m of MARKERS) {
            expect(other[m]).withContext(`the ${where === 'parent' ? 'extra' : 'parent'} is independent`)
              .toBe('snapshot');
          }
          expect(h.item_name_snapshot).toBe('Beef Burger');
          expect(h.quantity).toBe(2);
          expect(h.modifiers).toEqual(['Size: Large']);
          expect(h.allergen_tags).toEqual([{ name: 'Peanuts', icon: 'nut', colour: 'red' }]);
          expect(h.extras[0].item_name_snapshot).toBe('Cheese Slice');
          expect(h.extras[0].quantity).toBe(2);
          expect(h.extras[0].allergen_tags)
            .toEqual([{ name: 'Milk', icon: 'milk', colour: 'amber' }]);
          expect(service.activeTickets()[0].fulfilment_revision).toBe(4);
          expect(JSON.stringify(body)).withContext('the response is never written to')
            .toBe(sent);
        });
      }
    }
  }

  it('reads a PARTIAL set marker by marker: only what was sent is claimed', () => {
    const l = line();
    delete l.item_name_provenance;
    delete l.modifiers_provenance;
    l.allergen_tags_provenance = null;
    flushActive(feed([ticket({ items: [l] })]));

    const h = held();
    expect('item_name_provenance' in h).toBeFalse();
    expect('modifiers_provenance' in h).toBeFalse();
    expect(h.allergen_tags_provenance).toBe('missing');
  });

  it('never infers a marker from what the line holds', () => {
    // An empty legacy-looking line and a populated one, both WITHOUT markers.
    // Neither the blank name nor the empty lists may become `missing`, and the
    // populated values may not become `snapshot`: only the server says that.
    const blank = { item_name_snapshot: '', quantity: 1, modifiers: [], allergen_tags: [],
                    extras: [] };
    const full = line();
    for (const m of MARKERS) { delete full[m]; delete full.extras[0][m]; }
    flushActive(feed([ticket({ items: [blank, full] })]));

    const [b, f] = service.activeTickets()[0].items as any[];
    for (const m of MARKERS) {
      expect(m in b).withContext(`blank ${m}`).toBeFalse();
      expect(m in f).withContext(`full ${m}`).toBeFalse();
      expect(m in f.extras[0]).withContext(`extra ${m}`).toBeFalse();
    }
  });

  it('keeps a parent and its extra apart in both directions', () => {
    const l = line();
    for (const m of MARKERS) l[m] = 'missing';
    const k = line();
    for (const m of MARKERS) k.extras[0][m] = null;
    flushActive(feed([
      ticket({ items: [l] }),
      ticket({ id: 'k-02', order_number: 2, items: [k] }),
    ]));

    const [first, second] = service.activeTickets();
    for (const m of MARKERS) {
      expect((first.items[0] as any)[m]).toBe('missing');
      expect((first.items[0] as any).extras[0][m]).toBe('snapshot');
      expect((second.items[0] as any)[m]).toBe('snapshot');
      expect((second.items[0] as any).extras[0][m]).toBe('missing');
    }
  });

  it('leaves commands untouched: same revision, same request', () => {
    const l = line();
    for (const m of MARKERS) { l[m] = null; l.extras[0][m] = 7; }
    flushActive(feed([ticket({ items: [l], fulfilment_revision: 4 })]));

    expect(service.canCommand()).toBeTrue();
    expect(service.advanceStatus('k-01', 'preparing')).toBeTrue();
    const put = httpMock.expectOne(`${API}/kitchen/orders/k-01/fulfilment-status/`);
    expect(put.request.body).toEqual({ action: 'advance', if_revision: 4 });
    put.flush({ status: 200, outcome: 'applied',
                data: state({ fulfilment_revision: 5 }) });
    expect(service.activeTickets()[0].fulfilment_status).toBe('preparing');
    expect(service.operationFor('k-01')).toBeUndefined();
  });

  it('keeps an older server readable and read-only, with no markers invented', () => {
    const old = line();
    for (const m of MARKERS) { delete old[m]; delete old.extras[0][m]; }
    flushActive({ status: 200, data: { records: [
      { id: 'k-01', order_number: 1, table_label: 'T', order_source: 'diner_self_service',
        fulfilment_status: 'new', priority: false,
        created_at: new Date().toISOString(), served_at: null, items: [old] },
    ] } });

    expect(service.feedUnreadable()).toBeFalse();
    expect(service.canCommand()).toBeFalse();
    for (const m of MARKERS) expect(m in held()).toBeFalse();
  });

  // The existing required-field rules, with markers present: still refused,
  // and the last valid board is kept rather than replaced or blanked.
  const MALFORMED: [string, (l: any) => void][] = [
    ['a null name beside a missing marker',
     l => { l.item_name_snapshot = null; l.item_name_provenance = 'missing'; }],
    ['a string quantity', l => { l.quantity = '2'; }],
    ['null options beside a missing marker',
     l => { l.modifiers = null; l.modifiers_provenance = 'missing'; }],
    ['null allergens beside a missing marker',
     l => { l.allergen_tags = null; l.allergen_tags_provenance = 'missing'; }],
    ['a malformed allergen tag', l => { l.allergen_tags = [{ name: 'Nuts' }]; }],
    ['an extra with null options',
     l => { l.extras[0].modifiers = null; l.extras[0].modifiers_provenance = 'missing'; }],
    ['an extra with a null name', l => { l.extras[0].item_name_snapshot = null; }],
    ['extras that are not a list', l => { l.extras = { 0: l.extras[0] }; }],
  ];

  for (const [label, breakIt] of MALFORMED) {
    it(`still refuses ${label} and keeps the previous board`, () => {
      const good = line();
      good.allergen_tags_provenance = 'missing';
      flushActive(feed([ticket({ items: [good] })]));
      expect(service.feedUnreadable()).toBeFalse();

      const bad = line();
      breakIt(bad);
      flushActive(feed([ticket({ id: 'k-02', order_number: 2, items: [bad] })]));

      expect(service.feedUnreadable()).withContext('a malformed value is still a contract error')
        .toBeTrue();
      expect(service.activeTickets().map(t => t.id))
        .withContext('the last valid board is retained').toEqual(['k-01']);
      expect(held().item_name_snapshot).toBe('Beef Burger');
      expect(held().allergen_tags_provenance).toBe('missing');
    });
  }
});
