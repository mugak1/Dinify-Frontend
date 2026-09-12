import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import {
  CHECKOUT_RECORD_VERSION, CheckoutCoordinatorService, PURCHASE_CANON,
  RecoveryOutcome,
} from './checkout-coordinator.service';
import { SessionStorageService } from './storage/session-storage.service';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';
import { WINDOW } from './storage/window.token';

/**
 * D04 completion — the durability and correlation contract.
 *
 * FOUR THINGS D04/D LEFT OPEN, and what each block below is about.
 *
 *   THE DURABLE WRITE WAS NOT CHECKED. Every storage failure was swallowed
 *   and the key returned anyway, so a store that refuses writes produced the
 *   duplicate the key exists to prevent — silently, from the safety
 *   mechanism itself.
 *
 *   A NOT-FOUND RETIRED THE INTENT. One momentary observation discarded the
 *   identity of a checkout whose outcome was still open.
 *
 *   THE ISSUED COMMAND WAS NOT PROTECTED. A basket edit during an uncertain
 *   submit destroyed the only record of what was being recovered.
 *
 *   NOTHING VALIDATED THAT AN ANSWER WAS ABOUT THIS COMMAND, and nothing
 *   read the server's stated capability level.
 */
describe('CheckoutCoordinatorService — durability and correlation', () => {
  let service: CheckoutCoordinatorService;
  let storage: SessionStorageService;
  let api: jasmine.SpyObj<ApiService>;

  const BASKET = JSON.stringify(['{"i":"i1","m":[],"e":[]}x2']);
  const CONTEXT = 'r1:t1';
  const REQUEST = { identity: BASKET, canon: PURCHASE_CANON };

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: {} }) as any);

    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: 'durability-spec' },
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

  function reserve() {
    return service.reserveIntent(REQUEST, CONTEXT);
  }

  function ready(): string {
    const reservation = reserve();
    expect(reservation.kind).toBe('ready');
    return reservation.kind === 'ready' ? reservation.key : '';
  }

  function resolve(): RecoveryOutcome {
    let outcome!: RecoveryOutcome;
    service.recover().subscribe((value) => (outcome = value));
    return outcome;
  }

  function correlated(overrides: Record<string, unknown> = {},
                      acceptance: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      accepted: true,
      checkout: {
        order_id: 'o1',
        intent_key: service.record()?.key ?? null,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: {
          state: 'accepted', outcome: null,
          quote_ref: 'qref-original',
          accepted_at: '2026-09-12T10:00:00+00:00',
          ...acceptance,
        },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
        ...overrides,
      },
    };
  }

  // -- C02: the durable write is checked ---------------------------------

  describe('a durable write that does not land', () => {
    it('is REFUSED rather than reported as a weaker guarantee', () => {
      // THE DEFECT, stated directly. `write()` swallowed the throw and
      // `intentKey()` returned the key regardless — so the next call read
      // nothing back and minted a SECOND key. A storage failure turned the
      // idempotency mechanism into a duplicate generator, silently.
      spyOn(storage, 'setItem').and.throwError('QuotaExceededError');
      expect(reserve()).toEqual({ kind: 'storage-error' });
    });

    it('is caught even when the store SWALLOWS the write silently', () => {
      // A try/catch cannot see this one, and it is the realistic shape: a
      // store that accepts `setItem`, throws nothing and returns nothing.
      // Read-back is the only check that distinguishes the two.
      spyOn(storage, 'setItem').and.stub();
      expect(reserve()).toEqual({ kind: 'storage-error' });
    });

    it('reports a failed stage note rather than pretending it stuck', () => {
      ready();
      spyOn(storage, 'setItem').and.stub();
      expect(service.noteStage('reviewing')).toBeFalse();
    });

    it('reports a failed COMMAND note — the acceptance must not be sent', () => {
      // A command held only in memory cannot be replayed after the reload
      // that is the most likely response to a stuck checkout.
      ready();
      spyOn(storage, 'setItem').and.stub();
      expect(service.noteCommand({ orderId: 'o1', quoteRef: 'q1' }))
        .toBeFalse();
    });

    it('reports a failed terminal record', () => {
      ready();
      spyOn(storage, 'setItem').and.stub();
      expect(service.recordOutcome({
        kind: 'accepted', orderId: 'o1', orderNumber: null,
        quoteRef: 'q1', acceptedAt: null, at: 1,
      })).toBeFalse();
    });

    it('does not mistake an UNREADABLE store for an empty one', () => {
      spyOn(storage, 'getItem').and.throwError('SecurityError');
      expect(service.read()).toEqual({ kind: 'unreadable' });
      expect(reserve()).toEqual({ kind: 'storage-error' });
    });
  });

  // -- C02: five distinguishable storage states --------------------------

  describe('what is in storage', () => {
    it('distinguishes none from unreadable from malformed', () => {
      expect(service.read().kind).toBe('none');

      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, 'junk');
      expect(service.read().kind).toBe('malformed');

      storage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
      spyOn(storage, 'getItem').and.throwError('SecurityError');
      expect(service.read().kind).toBe('unreadable');
    });

    it('distinguishes a NEWER format from a broken one', () => {
      // Another tab on a newer build, mid deploy. Its contents are not ours
      // to interpret, and guessing at them is worse than saying so.
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY,
                      { v: CHECKOUT_RECORD_VERSION + 1, key: 'k' });
      const stored = service.read();
      expect(stored.kind).toBe('unsupported');
      expect((stored as any).version).toBe(CHECKOUT_RECORD_VERSION + 1);
    });

    it('BLOCKS rather than overwriting anything it cannot read', () => {
      for (const junk of [
        'junk', { v: CHECKOUT_RECORD_VERSION + 1, key: 'k' },
        { v: CHECKOUT_RECORD_VERSION, key: 'k' },
      ]) {
        storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, junk);
        expect(reserve().kind).withContext(JSON.stringify(junk))
          .toBe('blocked');
      }
    });

    it('never deletes a record it could not use', () => {
      const junk = { v: CHECKOUT_RECORD_VERSION + 1, key: 'future' };
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, junk);
      reserve();
      service.read();
      expect(storage.getItem<any>(CheckoutCoordinatorService.ATTEMPT_KEY))
        .toEqual(junk);
    });
  });

  // -- C02: the #663 record is carried forward ---------------------------

  describe('a D04/D (#663) record', () => {
    it('is UPGRADED, not discarded — the key survives a deploy', () => {
      // A diner mid-checkout across a deploy must keep their key; that is
      // the one thing the key exists to guarantee.
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, {
        key: 'old-key', phase: 'reviewing', orderId: null, quoteRef: null,
        basket: BASKET, context: CONTEXT, startedAt: 1,
      });
      const stored = service.read();
      expect(stored.kind).toBe('record');
      expect((stored as any).record.key).toBe('old-key');
      expect((stored as any).record.stage).toBe('reviewing');
      // and it is REUSED for the same basket at the same table
      const reservation = reserve();
      expect(reservation.kind).toBe('ready');
      expect((reservation as any).key).toBe('old-key');
    });

    it('carries an ISSUED COMMAND forward from a submitting record', () => {
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, {
        key: 'old-key', phase: 'submitting', orderId: 'o7', quoteRef: 'q7',
        basket: BASKET, context: CONTEXT, startedAt: 1,
      });
      const record = service.record()!;
      expect(record.stage).toBe('accepting');
      expect(record.command).toEqual({ orderId: 'o7', quoteRef: 'q7' });
      expect(service.isOutstanding(record)).toBeTrue();
    });

    it('MANUFACTURES nothing it was not told', () => {
      // A `submitting` record with no order id cannot name a command, so it
      // does not get one — and it lands `unresolved` rather than being
      // called a draft, because a submission was issued.
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, {
        key: 'old-key', phase: 'submitting',
        basket: BASKET, context: CONTEXT,
      });
      const record = service.record()!;
      expect(record.command).toBeNull();
      expect(record.stage).toBe('unresolved');
      expect(record.request.identity).toBe(BASKET);
    });
  });

  // -- C01: the issued command is protected ------------------------------

  describe('an outstanding acceptance', () => {
    function issue(): void {
      ready();
      service.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
    }

    it('is NOT overwritten when the basket changes', () => {
      // THE DEFECT. `intentKey()` replaced the record whenever the basket
      // or the table differed, so a diner editing their basket during an
      // uncertain submit destroyed the record of what was being recovered.
      issue();
      const reservation = service.reserveIntent(
        { identity: BASKET + 'edited', canon: PURCHASE_CANON }, CONTEXT);
      expect(reservation.kind).toBe('outstanding');
      expect(service.record()!.command)
        .toEqual({ orderId: 'o1', quoteRef: 'q1' });
    });

    it('is NOT overwritten when the table changes', () => {
      issue();
      expect(service.reserveIntent(REQUEST, 'r1:t9').kind)
        .toBe('outstanding');
      expect(service.record()!.command).not.toBeNull();
    });

    it('is NOT overwritten once it is unresolved either', () => {
      issue();
      service.noteStage('unresolved');
      expect(service.reserveIntent(
        { identity: BASKET + 'x', canon: PURCHASE_CANON }, CONTEXT).kind)
        .toBe('outstanding');
    });

    it('does not block once a terminal outcome is recorded', () => {
      issue();
      service.recordOutcome({
        kind: 'accepted', orderId: 'o1', orderNumber: null,
        quoteRef: 'q1', acceptedAt: null, at: 1,
      });
      expect(service.isOutstanding(service.record()!)).toBeFalse();
    });

    it('treats a changed canonicalisation rule as a different purchase', () => {
      // A record written under one rule cannot be compared against an
      // identity produced by another, so a future change is DETECTABLE
      // rather than silently reinterpreted.
      const first = ready();
      const second = service.reserveIntent(
        { identity: BASKET, canon: 'some-future-rule' }, CONTEXT);
      expect((second as any).key).not.toBe(first);
    });
  });

  // -- C01: a not-found never retires the intent -------------------------

  describe('resolving a key', () => {
    it('KEEPS the record on a proven absence', () => {
      const key = ready();
      api.get.and.returnValue(throwError(() => ({ status: 404 })) as any);
      expect(resolve()).toEqual({ kind: 'absent' });
      expect(service.record()!.key).toBe(key);
    });

    it('reports a denied session as UNAUTHORIZED, not absent', () => {
      // The scope could not be proven, so "no such order on this table" is
      // an answer about no table at all.
      ready();
      api.get.and.returnValue(throwError(
        () => ({ status: 404, error: { message: 'Not found.' } })) as any);
      expect(resolve()).toEqual({ kind: 'unauthorized' });
      expect(service.record()).not.toBeNull();
    });

    it('reports a record it cannot read as BLOCKED, and asks nothing', () => {
      storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY, 'junk');
      expect(resolve().kind).toBe('blocked');
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  // -- C03: the correlated answer ----------------------------------------

  describe('a correlated answer', () => {
    it('reports an accepted order with its ORIGINAL reference', () => {
      ready();
      api.get.and.returnValue(of({ data: correlated() }) as any);
      const outcome = resolve() as any;
      expect(outcome.kind).toBe('accepted');
      expect(outcome.correlation.acceptance.quoteRef).toBe('qref-original');
      expect(outcome.correlation.acceptance.acceptedAt)
        .toBe('2026-09-12T10:00:00+00:00');
    });

    it('separates a genuine draft from an UNRECORDED acceptance', () => {
      // THE HEADLINE. At level 2 these two read identically, and treating
      // the second as reviewable invites a diner to re-place an order that
      // is already in the kitchen.
      ready();
      api.get.and.returnValue(of({ data: correlated(
        {}, { state: 'not_accepted', quote_ref: null, accepted_at: null },
      ) }) as any);
      expect(resolve().kind).toBe('draft');

      api.get.and.returnValue(of({ data: correlated(
        {}, { state: 'evidence_unavailable',
              quote_ref: null, accepted_at: null },
      ) }) as any);
      expect(resolve().kind).toBe('accepted-unrecorded');
    });

    it('refuses an answer that is not about this command', () => {
      ready();
      api.get.and.returnValue(
        of({ data: correlated({ intent_key: 'someone-elses' }) }) as any);
      expect(resolve().kind).toBe('uncorrelated');
    });

    it('refuses an answer about another table', () => {
      ready();
      api.get.and.returnValue(of({ data: correlated(
        { scope: { restaurant: 'r1', table: 't9' } }) }) as any);
      expect(resolve().kind).toBe('uncorrelated');
    });

    it('refuses an answer about another order once one is issued', () => {
      ready();
      service.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      api.get.and.returnValue(
        of({ data: correlated({ order_id: 'o-other' }) }) as any);
      expect(resolve().kind).toBe('uncorrelated');
    });
  });

  // -- C03: the level-2 fallback -----------------------------------------

  describe('a server below the correlated level', () => {
    it('still trusts a definitive accepted', () => {
      ready();
      api.get.and.returnValue(of(
        { data: { id: 'o1', accepted: true, checkout_protocol: 2 } }) as any);
      expect(resolve().kind).toBe('accepted');
    });

    it('calls an unaccepted order a draft ONLY when nothing was issued', () => {
      // Resolved from THIS CLIENT'S OWN record, not inferred from a server
      // that cannot express the distinction: it never issued an acceptance
      // for this key, so there is no acceptance to have lost track of.
      ready();
      api.get.and.returnValue(of(
        { data: { id: 'o1', accepted: false, checkout_protocol: 2 } }) as any);
      expect(resolve().kind).toBe('draft');
    });

    it('reports UNSUPPORTED when an acceptance IS outstanding', () => {
      ready();
      service.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      api.get.and.returnValue(of(
        { data: { id: 'o1', accepted: false, checkout_protocol: 2 } }) as any);
      const outcome = resolve() as any;
      expect(outcome.kind).toBe('unsupported');
      expect(outcome.protocol).toBe(2);
    });

    it('treats a pre-D04 server (no level at all) the same way', () => {
      ready();
      service.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      api.get.and.returnValue(of({ data: { id: 'o1' } }) as any);
      const outcome = resolve() as any;
      expect(outcome.kind).toBe('unsupported');
      expect(outcome.protocol).toBe(0);
    });
  });
});
