/**
 * D04 Gate C — INCOMPLETE DURABLE STATE MUST NOT BECOME PERMISSION TO
 * REPLACE IT.
 *
 * The precise missed test. `upgradeV1()` turns a D04/D `phase: 'submitting'`
 * record with no usable order id into `stage: 'unresolved', command: null`.
 * That much is honest — nothing is manufactured. But `isOutstanding()`
 * requires `command !== null`, so the record it just produced reads as NOT
 * outstanding, and `reserveIntent()` on a changed basket replaces it with a
 * fresh key. The existing durability spec checks the upgrade's OUTPUT and
 * stops there; it never follows that output into reservation, which is where
 * the protection is actually lost.
 *
 * THE PRINCIPLE. Protection follows the fact that a command MAY HAVE BEEN
 * ISSUED — not whether its surviving fields happen to be complete enough to
 * replay. Missing handles reduce the ability to recover; they never establish
 * that no operation ran.
 *
 * `persist()` has the matching hole at the other end: it verifies only key
 * and stage on read-back, so a same-key/same-stage write whose COMMAND failed
 * to land is reported successful, and the caller then sends a mutation it
 * believes is recorded.
 *
 * Every storage fixture here is SYNTHETIC — hand-written records standing for
 * a mid-deploy tab, a truncated quota write or a store that silently drops.
 */
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from './api.service';
import {
  CHECKOUT_RECORD_VERSION, CheckoutCoordinatorService, PURCHASE_CANON,
} from './checkout-coordinator.service';
import { SessionStorageService } from './storage/session-storage.service';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';
import { WINDOW } from './storage/window.token';

describe('CheckoutCoordinatorService — protection of incomplete state '
         + '(D04 Gate C)', () => {
  let service: CheckoutCoordinatorService;
  let storage: SessionStorageService;
  let api: jasmine.SpyObj<ApiService>;

  const BASKET = JSON.stringify(['{"i":"i1","m":[],"e":[]}x2']);
  const OTHER_BASKET = JSON.stringify(['{"i":"i9","m":[],"e":[]}x5']);
  const CONTEXT = 'r1:t1';
  const REQUEST = { identity: BASKET, canon: PURCHASE_CANON };
  const CHANGED = { identity: OTHER_BASKET, canon: PURCHASE_CANON };

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: {} }) as any);

    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'gate-c-spec' },
        { provide: ApiService, useValue: api },
      ],
    });
    service = TestBed.inject(CheckoutCoordinatorService);
    storage = TestBed.inject(SessionStorageService);
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  afterEach(() => {
    storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  function put(value: unknown): void {
    storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, value);
  }

  // -- the precise missed test -------------------------------------------

  it('does not replace a D04/D submitting record that lost its order id',
     () => {
    // A #663 record mid-submission whose order id did not survive. An
    // acceptance MAY have been issued for this key. Handing the diner a
    // fresh key here is exactly the duplicate the mechanism exists to stop.
    put({ key: 'k-legacy', phase: 'submitting', basket: BASKET,
          context: CONTEXT, startedAt: 1 });

    const reservation = service.reserveIntent(CHANGED, CONTEXT);

    expect(reservation.kind).not.toBe('ready');
    expect(service.record()?.key).toBe('k-legacy');
  });

  it('does not replace a v2 accepting record whose command is malformed',
     () => {
    put({ v: CHECKOUT_RECORD_VERSION, key: 'k-malformed', scope: CONTEXT,
          request: { identity: BASKET, canon: PURCHASE_CANON },
          stage: 'accepting', command: { orderId: 42 }, outcome: null,
          startedAt: 1 });

    const reservation = service.reserveIntent(CHANGED, CONTEXT);

    expect(reservation.kind).not.toBe('ready');
    expect(service.record()?.key).toBe('k-malformed');
  });

  it('does not replace an unresolved v2 record with no command at all', () => {
    put({ v: CHECKOUT_RECORD_VERSION, key: 'k-unresolved', scope: CONTEXT,
          request: { identity: BASKET, canon: PURCHASE_CANON },
          stage: 'unresolved', command: null, outcome: null, startedAt: 1 });

    const reservation = service.reserveIntent(CHANGED, CONTEXT);

    expect(reservation.kind).not.toBe('ready');
  });

  it('does not replace a record written under an unknown canonicalisation',
     () => {
    // A record whose identity was produced by a rule this build does not
    // know cannot be compared against one produced by the current rule, so
    // "different purchase" is not a conclusion available here.
    put({ v: CHECKOUT_RECORD_VERSION, key: 'k-canon', scope: CONTEXT,
          request: { identity: BASKET, canon: 'some-future-canon-v9' },
          stage: 'accepting', command: { orderId: 'o1', quoteRef: 'q1' },
          outcome: null, startedAt: 1 });

    const reservation = service.reserveIntent(REQUEST, CONTEXT);

    expect(reservation.kind).not.toBe('ready');
  });

  it('does not treat an accepted record with incoherent evidence as settled',
     () => {
    // `stage: 'accepted'` with no outcome is not a completed checkout; it is
    // a record that cannot say what happened. Reserving over it discards an
    // outcome that may be real.
    put({ v: CHECKOUT_RECORD_VERSION, key: 'k-partial', scope: CONTEXT,
          request: { identity: BASKET, canon: PURCHASE_CANON },
          stage: 'accepted', command: { orderId: 'o1', quoteRef: 'q1' },
          outcome: null, startedAt: 1 });

    const reservation = service.reserveIntent(CHANGED, CONTEXT);

    expect(reservation.kind).not.toBe('ready');
  });

  // -- persistence must verify the payload, not just key and stage --------

  it('detects a silent no-op write that did not change the command', () => {
    // The realistic shape of a failing store: `setItem` returns without
    // error and `getItem` still yields the PREVIOUS value. Key and stage
    // are unchanged by this write, so a check on those two alone reports
    // success and the caller issues an acceptance it believes is recorded.
    const reservation = service.reserveIntent(REQUEST, CONTEXT);
    expect(reservation.kind).toBe('ready');
    service.noteStage('accepting');
    const frozen = storage.getItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    spyOn(storage, 'setItem').and.stub();          // accepts, changes nothing
    spyOn(storage, 'getItem').and.returnValue(frozen);

    const ok = service.noteCommand({ orderId: 'o1', quoteRef: 'q1' });

    expect(ok).toBeFalse();
  });

  it('detects a silent no-op write that did not record the outcome', () => {
    const reservation = service.reserveIntent(REQUEST, CONTEXT);
    expect(reservation.kind).toBe('ready');
    service.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
    service.noteStage('accepted');
    const frozen = storage.getItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    spyOn(storage, 'setItem').and.stub();
    spyOn(storage, 'getItem').and.returnValue(frozen);

    const ok = service.recordOutcome({
      kind: 'accepted', orderId: 'o1', orderNumber: null,
      quoteRef: 'q1', acceptedAt: '2026-09-12T10:00:00+00:00', at: 2,
    });

    expect(ok).toBeFalse();
  });

  // -- the controls: ordinary cases must keep working --------------------

  it('still reserves normally when nothing is stored', () => {
    expect(service.reserveIntent(REQUEST, CONTEXT).kind).toBe('ready');
  });

  it('still reuses the key for the same purchase at the same table', () => {
    const first = service.reserveIntent(REQUEST, CONTEXT);
    const second = service.reserveIntent(REQUEST, CONTEXT);
    expect(second.kind).toBe('ready');
    expect(second.kind === 'ready' && first.kind === 'ready'
      && second.key === first.key).toBeTrue();
  });

  it('still mints a fresh key for a different purchase with no command out',
     () => {
    const first = service.reserveIntent(REQUEST, CONTEXT);
    const second = service.reserveIntent(CHANGED, CONTEXT);
    expect(second.kind).toBe('ready');
    expect(second.kind === 'ready' && first.kind === 'ready'
      && second.key !== first.key).toBeTrue();
  });

  it('still upgrades a complete D04/D submitting record and protects it',
     () => {
    put({ key: 'k-complete', phase: 'submitting', orderId: 'o1',
          quoteRef: 'q1', basket: BASKET, context: CONTEXT, startedAt: 1 });

    const reservation = service.reserveIntent(CHANGED, CONTEXT);

    expect(reservation.kind).toBe('outstanding');
    expect(service.record()?.command).toEqual({ orderId: 'o1',
                                                quoteRef: 'q1' });
  });

  it('still upgrades a D04/D reviewing record as reservable', () => {
    // No acceptance was ever issued in `reviewing`, so this one may be
    // replaced by a genuinely different purchase.
    put({ key: 'k-review', phase: 'reviewing', basket: BASKET,
          context: CONTEXT, startedAt: 1 });

    expect(service.reserveIntent(CHANGED, CONTEXT).kind).toBe('ready');
  });

  it('still reports a genuinely complete accepted record as recoverable',
     () => {
    put({ v: CHECKOUT_RECORD_VERSION, key: 'k-done', scope: CONTEXT,
          request: { identity: BASKET, canon: PURCHASE_CANON },
          stage: 'accepted', command: { orderId: 'o1', quoteRef: 'q1' },
          outcome: { kind: 'accepted', orderId: 'o1', orderNumber: '7',
                     quoteRef: 'q1', acceptedAt: '2026-09-12T10:00:00+00:00',
                     at: 2 },
          startedAt: 1 });

    const stored = service.read();

    expect(stored.kind).toBe('record');
    expect(stored.kind === 'record' && stored.record.outcome?.orderId)
      .toBe('o1');
  });
});
