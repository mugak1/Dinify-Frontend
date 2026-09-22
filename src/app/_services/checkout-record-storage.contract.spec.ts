import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import declaration from './checkout-record.storage.json';
import { ApiService } from './api.service';
import {
  CHECKOUT_RECORD_VERSION, CheckoutCoordinatorService, PURCHASE_CANON,
} from './checkout-coordinator.service';
import { SessionStorageService } from './storage/session-storage.service';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';
import { WINDOW } from './storage/window.token';

/**
 * D08 B1 (R2) — THE STORAGE DECLARATION IS THE CODE'S BEHAVIOUR, NOT A CLAIM BESIDE IT.
 *
 * `checkout-record.storage.json` states the (version, semantics) pairs this build
 * WRITES and can READ, and the release gate refuses to promote a build that cannot
 * read every pair the served build writes or reads. That rule is only as good as the
 * declaration, and a declaration is a sentence somebody wrote. This spec is what makes
 * it a checked sentence: it drives the REAL coordinator, through the REAL session
 * storage service, with a stored record of EVERY declared read pair, and asserts the
 * one property the whole barrier exists for —
 *
 *   an OUTSTANDING ISSUED COMMAND survives, UNDER THE SAME KEY.
 *
 * That is what "can read" has to mean here. A reader that parses a record and then
 * lets a changed basket mint a fresh key has read it and still created the duplicate
 * order the key exists to prevent.
 *
 * A DECLARED PAIR WITH NO FIXTURE FAILS. Adding `{version: 2, semantics: 2}` to
 * `reads` without adding the record it describes here is refused, so the declaration
 * cannot claim to read a shape nothing has ever proved it reads.
 */
describe('checkout record storage — the declared compatibility is the behaviour (D08 R2)', () => {
  let service: CheckoutCoordinatorService;
  let storage: SessionStorageService;

  const BASKET = JSON.stringify(['{"i":"i1","m":[],"e":[]}x2']);
  const OTHER_BASKET = JSON.stringify(['{"i":"i9","m":[],"e":[]}x1']);
  const CONTEXT = 'r1:t1';

  type Pair = { version: number; semantics: number };
  const pairKey = (p: Pair) => `${p.version}.${p.semantics}`;

  /**
   * One stored record per declared read pair, each carrying an ISSUED command — the
   * state a rollback or a deploy must never strand.
   */
  const FIXTURES: Record<string, { stored: Record<string, unknown>; key: string; orderId: string }> = {
    // version 1: the UNVERSIONED D04/D (#663) shape. No `v`; `phase`, not `stage`.
    '1.1': {
      key: 'k-d04d',
      orderId: 'o-d04d',
      stored: {
        key: 'k-d04d', phase: 'submitting', orderId: 'o-d04d', quoteRef: 'q-d04d',
        basket: BASKET, context: CONTEXT, startedAt: 1,
      },
    },
    // version 2: CHECKOUT_RECORD_VERSION, as this build writes it.
    '2.1': {
      key: 'k-v2',
      orderId: 'o-v2',
      stored: {
        v: 2, key: 'k-v2', scope: CONTEXT,
        request: { identity: BASKET, canon: PURCHASE_CANON, items: [{ item: 'i1', quantity: 2 }] },
        stage: 'accepting',
        command: { orderId: 'o-v2', quoteRef: 'q-v2' },
        outcome: null, startedAt: 1, protocol: 3, quoteProtocol: 2,
        replaces: null, closure: null,
      },
    },
  };

  beforeEach(() => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: {} }) as never);
    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'storage-contract-spec' },
        { provide: ApiService, useValue: api },
      ],
    });
    service = TestBed.inject(CheckoutCoordinatorService);
    storage = TestBed.inject(SessionStorageService);
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  afterEach(() => storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY));

  it('names the key and the store the coordinator actually uses', () => {
    expect(declaration.key).toBe(CheckoutCoordinatorService.ATTEMPT_KEY);
    expect(declaration.store).toBe('sessionStorage');
  });

  it('declares exactly the version this build writes', () => {
    expect(declaration.writes.version).toBe(CHECKOUT_RECORD_VERSION);
  });

  it('every declared read pair has a recovery fixture — a pair nothing proves is refused', () => {
    for (const pair of declaration.reads as Pair[]) {
      expect(FIXTURES[pairKey(pair)])
        .withContext(`declared read pair ${pairKey(pair)} has no fixture in this spec`)
        .toBeDefined();
    }
  });

  for (const pair of declaration.reads as Pair[]) {
    const fixture = FIXTURES[pairKey(pair)];
    if (!fixture) continue;

    it(`CONTRACT: a stored ${pairKey(pair)} record is read with its issued command under the SAME key`, () => {
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, fixture.stored);
      const stored = service.read();
      expect(stored.kind).toBe('record');
      if (stored.kind !== 'record') return;
      expect(stored.record.key).toBe(fixture.key);
      expect(stored.record.command?.orderId).toBe(fixture.orderId);
    });

    it(`CONTRACT: a changed basket cannot replace a stored ${pairKey(pair)} command — same-key recovery survives`, () => {
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, fixture.stored);
      const reservation = service.reserveIntent({ identity: OTHER_BASKET, canon: PURCHASE_CANON }, CONTEXT);
      expect(reservation.kind).toBe('outstanding');
      const after = service.read();
      expect(after.kind === 'record' ? after.record.key : null).toBe(fixture.key);
    });
  }

  it('CONTROL: an UNDECLARED record version is unsupported and blocks — it is never replaced', () => {
    const highest = Math.max(...(declaration.reads as Pair[]).map((p) => p.version));
    const future = { v: highest + 1, key: 'k-future', stage: 'accepting' };
    storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, future);
    expect(service.read().kind).toBe('unsupported');
    expect(service.reserveIntent({ identity: BASKET, canon: PURCHASE_CANON }, CONTEXT).kind).toBe('blocked');
    expect(storage.getItem(CheckoutCoordinatorService.ATTEMPT_KEY)).toEqual(future);
  });

  it('CONTRACT: what a fresh checkout writes is the declared `writes` pair', () => {
    const reservation = service.reserveIntent({ identity: BASKET, canon: PURCHASE_CANON }, CONTEXT);
    expect(reservation.kind).toBe('ready');
    const raw = storage.getItem(CheckoutCoordinatorService.ATTEMPT_KEY) as Record<string, unknown>;
    expect(raw['v']).toBe(declaration.writes.version);
    const pairs = (declaration.reads as Pair[]).map(pairKey);
    expect(pairs).toContain(pairKey(declaration.writes as Pair));
  });
});
