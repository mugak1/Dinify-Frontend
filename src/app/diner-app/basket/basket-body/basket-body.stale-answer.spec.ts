/**
 * D06/C — AN ANSWER MAY ONLY ACT ON THE OPERATION THAT ASKED FOR IT.
 *
 * Three findings from the Codex review of #675, all of them the same shape and
 * all of them a rule this work had already established reaching only part of
 * the code it governs.
 *
 *   F1  THE REVIEW WAS NOT BOUND TO ITS ATTEMPT. `renewQuote`'s retired branch
 *       renewed `this.checkout.record()` — whatever storage held when the
 *       answer landed — so a mount holding a STALE sheet for O1/Q1 could take
 *       Q1's closure and abandon the live K2 successor the OTHER mount had
 *       already minted for it. `settles(owner)` cannot see it: that owner is
 *       frozen when the ENQUIRY is issued, which is after the renewal. Only
 *       the key distinguishes two attempts at one purchase — a renewal carries
 *       `request` and `scope` across unchanged, so the revision, the context
 *       and the scope are identical either side of it.
 *
 *   F2  THE RESEND GUARDED ON A COMPONENT COUNTER. `issued.seq` moves when
 *       THIS instance starts something newer and never when another one does,
 *       and Angular does not cancel an in-flight request on destroy — so a
 *       resend outliving its component landed with its seq still matching and
 *       wrote to the SHARED record. `renewQuote` was given the immutable owner
 *       for exactly this reason; the resend was left on the old mechanism.
 *
 *   F3  A PARTIAL CORRELATION AUTHORIZED SUBMISSION. At a demonstrated level 2
 *       the answer was refused only when BOTH `order` and `quote_ref` were
 *       absent. The backend stamps `order` unconditionally and echoes
 *       `quote_ref` whenever the caller named one — and this client always
 *       does — so an answer carrying one of them is as broken as one carrying
 *       neither. Naming the ORDER establishes nothing about WHICH QUOTE of it,
 *       which is the entire question a lifetime enquiry asks.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject, of } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService, PURCHASE_CANON,
} from '../../../_services/checkout-coordinator.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — a stale answer owns nothing (D06/C)', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  const AMOUNT = '5000.00';

  const quoteLine = () => ({
    id: 'l1', item: 'i1', item_name: 'Burger', quantity: 1,
    available: true, status: 'available',
    selected_modifiers: {}, modifiers: [], options: [],
    unit_price: AMOUNT, reference_unit_price: AMOUNT,
    discounted_price: AMOUNT, unit_cost_of_options: '0.00', discounted: false,
    total_cost: AMOUNT, reference_total_cost: AMOUNT, discounted_cost: AMOUNT,
    savings: '0.00', line_actual_cost: AMOUNT, line_total_with_extras: AMOUNT,
    extras: [] as unknown[],
  });

  /** A priced draft whose published deadline is long past, so `confirmQuote`
   *  asks the server rather than submitting. Declares level 2. */
  const priced = (details: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1', quote_ref: 'q1', actual_cost: Number(AMOUNT),
        quote_total: AMOUNT, pricing_version: 'CORRECTED',
        no_items: 1, no_available_items: 1, no_unavailable_items: 0,
        no_available_extras: 0, no_unavailable_extras: 0,
        quote: [quoteLine()],
        quote_protocol: 2,
        quote_policy: {
          version: 1, status: 'live',
          expires_at: '2020-01-01T00:00:00Z',
        },
        ...details,
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
    },
  });

  const CLOSURE_FACTS = {
    quote_closure: {
      closed_at: '2026-09-18T10:00:00Z',
      reason: 'quote_expired',
      quote_ref: 'q1',
      policy_version: 1,
    },
  };

  /** What the route really sends: every answer stating an outcome names the
   *  order and echoes the reference the caller supplied. */
  const answer = (outcome: string, over: Record<string, unknown> = {}) => ({
    status: 200, message: 'ok', outcome,
    order: 'o1', quote_ref: 'q1', quote_protocol: 2,
    ...(outcome === 'quote_closed' ? CLOSURE_FACTS : {}),
    ...over,
  });

  const call = (route: string) =>
    api.postPatch.calls.allArgs().filter((args) => args[0] === route);

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.get.and.returnValue(of({ data: null }) as any);
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => 1,
      contentIdentity: () =>
        BasketService.prototype.contentIdentity.call(basketService),
      totalState: (items: BasketItem[]) =>
        BasketService.prototype.totalState.call(basketService, items),
    };

    await TestBed.configureTestingModule({
      imports: [BasketBodyComponent],
      providers: [
        provideHttpClient(withXhr()), provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
        { provide: ApiService, useValue: api },
        {
          provide: ConfirmDialogService,
          useValue: jasmine.createSpyObj<ConfirmDialogService>(
            'ConfirmDialogService', ['openModal', 'closeModal']),
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>(
            'ToastService',
            ['success', 'error', 'info', 'warning', 'clear', 'dismiss']),
        },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    spyOn(TestBed.inject(Router), 'navigate').and.stub();
    coordinator = TestBed.inject(CheckoutCoordinatorService);
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  /** Price a draft and leave the review sheet open, as a diner sees it. */
  function reviewed(): string {
    api.postPatch.and.callFake(((route: string) => {
      if (route === 'orders/initiate/') return of(priced()) as any;
      return of({ status: 200, message: 'placed' }) as any;
    }) as any);
    component.initiateOrder();
    return coordinator.record()?.key ?? '';
  }

  /** The OTHER mount settles this quote's closure and mints the successor —
   *  the two steps production now takes, in that order (O1) — and it is what
   *  leaves this instance's sheet stale. */
  function theOtherMountRenews(): string {
    expect(coordinator.noteClosure({
      closedAt: '2026-09-18T10:00:00Z', reason: 'quote_expired',
      quoteRef: 'q1', policyVersion: 1,
    })).toBeTrue();
    const renewal = coordinator.renewAfterClosure();
    expect(renewal.kind).toBe('ready');
    return coordinator.record()?.key ?? '';
  }

  /** Confirm the (possibly stale) review; the deadline has passed, so this
   *  asks the server rather than submitting. */
  function confirmWith(retire: any): void {
    api.postPatch.and.callFake(((route: string) => {
      if (route === 'orders/initiate/') return of(priced()) as any;
      if (route === 'orders/retire-quote/') return retire as any;
      return of({ status: 200, message: 'placed' }) as any;
    }) as any);
    (component as any).confirmQuote();
  }

  // ------------------------------------------------------------------
  // F1 — the review is bound to the attempt it was priced under
  // ------------------------------------------------------------------

  describe('a review whose attempt has been superseded', () => {
    it('THE REGRESSION: a stale sheet does NOT renew away the live '
       + 'successor', () => {
      const k1 = reviewed();
      const k2 = theOtherMountRenews();
      expect(k2).not.toBe(k1);

      confirmWith(of(answer('quote_closed')));

      // Q1's closure belongs to K1, which is finished. Acting on it here would
      // mint K3 and abandon K2 — a valid, live attempt at the same purchase,
      // discarded on the strength of a closure about a different one.
      expect(coordinator.record()?.key).toBe(k2);
      expect(call('orders/submit/').length).toBe(0);
      // And nothing is re-priced under anything: the diner is told the order
      // changed and sent back to look at it.
      expect(call('orders/initiate/').length).toBe(1);
      expect(component.orderError).toBeTrue();
    });

    it('nor does a stale sheet SUBMIT on a still-valid answer', () => {
      const k1 = reviewed();
      const k2 = theOtherMountRenews();
      expect(k2).not.toBe(k1);

      confirmWith(of(answer('quote_still_valid')));

      expect(call('orders/submit/').length).toBe(0);
      expect(coordinator.record()?.key).toBe(k2);
    });

    it('CONTROL: the SAME closed answer IS acted on when the review is still '
       + 'the current attempt', () => {
      // CHANGED EXPECTATION in one respect only, and the discriminating half
      // is unchanged: the stale case above still does NOTHING, and this one
      // still ACTS. What "acts" means moved — O1 establishes the closure and
      // offers the review rather than minting a key inside the handler — so
      // the key moves on the tap rather than on the answer.
      const k1 = reviewed();

      confirmWith(of(answer('quote_closed')));

      expect(component.quoteRetired).toBeTrue();
      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .toBe('closure');
      expect(coordinator.record()?.key).toBe(k1);

      component.reviewUpdatedOrder();
      expect(coordinator.record()?.key).not.toBe(k1);
      expect(coordinator.record()?.key).toBeTruthy();
      expect(call('orders/initiate/').length).toBe(2);
    });

    it('CONTROL: the SAME still-valid answer submits when the review is '
       + 'current', () => {
      reviewed();
      confirmWith(of(answer('quote_still_valid')));
      expect(call('orders/submit/').length).toBe(1);
    });

    it('the review records the attempt it was priced under', () => {
      const k1 = reviewed();
      expect((component as any).reviewedQuote.key).toBe(k1);
    });
  });

  // ------------------------------------------------------------------
  // F2 — a resend that outlives its instance mutates nothing
  // ------------------------------------------------------------------

  describe('a resend whose instance is gone', () => {
    /** An interrupted acceptance: a reserved key with a command against it. */
    function outstanding(): string {
      const reservation = coordinator.reserveIntent(
        { identity: basketService.contentIdentity(), canon: PURCHASE_CANON },
        ':');
      coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
      return reservation.kind === 'ready' ? reservation.key : '';
    }

    const terminalRefusal = () => ({
      status: 400, message: 'refused: quote_expired',
      reason: 'quote_expired', ...CLOSURE_FACTS,
    });

    it('THE REGRESSION: a refusal landing after destroy writes no closure',
       () => {
      outstanding();
      const submit = new Subject<any>();
      api.postPatch.and.returnValue(submit as any);

      (component as any).resendIssuedCommand({
        orderId: 'o1', quoteRef: 'q1',
      });
      fixture.destroy();
      submit.error(terminalRefusal());

      // `applyQuoteRefusal` settles the command and records the closure on
      // whatever record is current. A destroyed instance owns none of that.
      const record = coordinator.record();
      expect(record?.closure ?? null).toBeNull();
      expect(record?.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
      expect(record?.stage).toBe('accepting');
    });

    it('nor does a success landing after destroy record an outcome', () => {
      outstanding();
      const submit = new Subject<any>();
      api.postPatch.and.returnValue(submit as any);

      (component as any).resendIssuedCommand({
        orderId: 'o1', quoteRef: 'q1',
      });
      fixture.destroy();
      submit.next({ status: 200, message: 'placed' });

      expect(coordinator.record()?.outcome ?? null).toBeNull();
      expect(basketService.clearBasket).not.toHaveBeenCalled();
    });

    it('a refusal landing after ANOTHER attempt replaced the record writes '
       + 'nothing to it', () => {
      const k1 = outstanding();
      const submit = new Subject<any>();
      api.postPatch.and.returnValue(submit as any);

      (component as any).resendIssuedCommand({
        orderId: 'o1', quoteRef: 'q1',
      });
      // The other mount settles and renews while this resend is open.
      coordinator.settleRefusedCommand();
      const k2 = theOtherMountRenews();
      expect(k2).not.toBe(k1);

      submit.error(terminalRefusal());

      // K2 is a fresh attempt at the same purchase and has no command of its
      // own; Q1's refusal must not settle one against it or retire it.
      const record = coordinator.record();
      expect(record?.key).toBe(k2);
      expect(record?.closure ?? null).toBeNull();
      expect(record?.stage).toBe('pricing');
    });

    it('CONTROL: a refusal on a LIVE instance still records the closure',
       () => {
      outstanding();
      const submit = new Subject<any>();
      api.postPatch.and.returnValue(submit as any);

      (component as any).resendIssuedCommand({
        orderId: 'o1', quoteRef: 'q1',
      });
      submit.error(terminalRefusal());

      const record = coordinator.record()!;
      const reading = coordinator.closureOf(record);
      expect(reading.evidence.kind === 'closure'
        && reading.evidence.closure.quoteRef).toBe('q1');
      // O1 — AND IT NAMES THE ATTEMPT IT WAS WRITTEN AGAINST.
      expect(reading.predecessor?.key).toBe(record.key);
      expect(reading.predecessor?.orderId).toBe('o1');
      expect(record.stage).toBe('refused');
      expect(component.quoteRetired).toBeTrue();
    });
  });

  // ------------------------------------------------------------------
  // F3 — at level 2 an answer names BOTH, or it names nothing usable
  // ------------------------------------------------------------------

  describe('a partially correlated answer', () => {
    it('THE REGRESSION: naming the order but not the reference does NOT '
       + 'authorize a submission', () => {
      reviewed();
      confirmWith(of(answer('quote_still_valid', { quote_ref: undefined })));
      expect(call('orders/submit/').length).toBe(0);
      expect(component.orderError).toBeTrue();
    });

    it('nor does naming the reference but not the order', () => {
      reviewed();
      confirmWith(of(answer('quote_still_valid', { order: undefined })));
      expect(call('orders/submit/').length).toBe(0);
    });

    it('a partially correlated CLOSED answer retires nothing', () => {
      const k1 = reviewed();
      confirmWith(of(answer('quote_closed', { quote_ref: undefined })));
      // Unreadable, so the quote is neither known dead nor known good: the key
      // survives and nothing is renewed.
      expect(coordinator.record()?.key).toBe(k1);
      expect(component.quoteRetired).toBeFalse();
    });

    it('CONTROL: naming both still submits', () => {
      reviewed();
      confirmWith(of(answer('quote_still_valid')));
      expect(call('orders/submit/').length).toBe(1);
    });

    it('CONTROL: a genuinely pre-level-2 server naming neither is still '
       + 'honoured', () => {
      // The tolerance this narrowing must not eat. A server that has never
      // declared level 2 promises no correlation at all, and refusing it would
      // leave every older backend unable to finish a checkout whose deadline
      // had passed.
      api.postPatch.and.callFake(((route: string) => {
        if (route === 'orders/initiate/') {
          return of(priced({ quote_protocol: undefined })) as any;
        }
        if (route === 'orders/retire-quote/') {
          return of({ status: 200, message: 'ok',
                      outcome: 'quote_still_valid' }) as any;
        }
        return of({ status: 200, message: 'placed' }) as any;
      }) as any);
      component.initiateOrder();
      (component as any).confirmQuote();

      expect(call('orders/submit/').length).toBe(1);
    });
  });
});
