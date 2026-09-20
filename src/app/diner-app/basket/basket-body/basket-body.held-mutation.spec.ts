/**
 * I2-C (completion) — THE SHARED HOLD REACHES THE RESEND AND THE CONTRADICTION.
 *
 * #678 put the unresolved-closure observation in the coordinator and gated
 * FOUR shared decisions on it: `reserveIntent`, `isReplayableInitiation`,
 * `noteCommand` and `renewAfterClosure`. Two consumers were left outside it,
 * and both are ones the original I2-C requirement named.
 *
 * H1 — A RECOVERY ALREADY IN FLIGHT BYPASSES A HOLD ESTABLISHED SINCE.
 * `retryOrder()` asks `closureUnresolved` ONCE, at the press, and then
 * `replayIssuedCommand()` opens an authorized GET. Its draft/absent callback
 * re-checks ownership (`ownsRecovery`) and the original command, and calls
 * `resendIssuedCommand()`, which PUTs `orders/submit/` directly.
 *
 * It never reaches the structural gate, and the reason is worth stating
 * exactly: `noteCommand` refuses a held attempt, and every acceptance in this
 * client is written down before it is sent — EXCEPT this one, because the
 * command was already persisted before the ORIGINAL acceptance. A resend
 * re-sends what is on the record, so it writes nothing, so it passes through
 * the one gate that would have stopped it. `ownsRecovery` cannot cover it
 * either: it answers "may this answer settle the operation it was about",
 * which is a question about identity, not about whether a mutation is still
 * permitted.
 *
 * So the entry check is a check on the wrong instant. The GET can be
 * outstanding for as long as the network takes, and a hold established during
 * that window — by the other mount, by a routed instance's startup recovery,
 * by a submit refusal — is invisible to the callback that resends.
 *
 * H2 — A CONTRADICTORY ANSWER IS DELIBERATELY NOT SHARED. `inconsistent` (the
 * projection says the order was ACCEPTED *and* its quote was RETIRED, which
 * the server has no coherent way to produce) blocks the mount that received
 * it, via `this.recovered` — a field on ONE component. The shared record is
 * untouched by design, because neither half may be persisted. So the second
 * mount reads an ordinary attempt and is free to mutate, which is the exact
 * cross-mount gap #678 closed for the other two closure situations.
 *
 * WHAT THESE SPECS DRIVE. Real `BasketBodyComponent` instances over ONE real
 * `CheckoutCoordinatorService`, real session storage, the real `ApiService`,
 * the real `HttpClient` and the real `ErrorInterceptor`. The second mount's
 * OWN methods and the coordinator's OWN shared decisions are exercised —
 * never a second call on the first instance, and never a spy standing in for
 * the gate under test.
 *
 * THE CONTROLS ARE THE OTHER HALF. A draft read with NO hold must still
 * resend the exact original command; an accepted answer must still be
 * recoverable; a valid closure must still persist and support ONE deliberate
 * successor; and ordinary network uncertainty must still offer a real Retry.
 * Without those this would be a change that bans recovery rather than one
 * that gates a mutation.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import {
  HttpTestingController, provideHttpClientTesting, TestRequest,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from 'src/environments/environment';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX }
  from '../../../_services/storage/storage-key-prefix.token';
import { SessionStorageService }
  from '../../../_services/storage/session-storage.service';
import { BasketService } from '../../../_services/basket.service';
import { CheckoutCoordinatorService }
  from '../../../_services/checkout-coordinator.service';
import { reviewQuote } from '../../../_shared/order/quote-review';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';
import { correctedInitiate } from './corrected-quote.fixture';

describe('BasketBodyComponent — the hold reaches the resend and the '
         + 'contradiction (D06/I2-C)', () => {
  let http: HttpTestingController;
  let basket: { items: BasketItem[]; totalAmount: number };
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let storage: SessionStorageService;

  const API = `${environment.apiUrl}/api`;
  const V1 = `${API}/${environment.version}`;
  const INITIATE = `${API}/v2/orders/initiate/`;
  const SUBMIT = `${V1}/orders/submit/`;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  /** A closure this build CAN act on — valid, supported, naming this quote. */
  const CLOSURE = {
    closed_at: '2026-09-20T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
  };

  /**
   * The diner's own scoped read, in the shape the server actually sends it:
   * the order details are FLAT on `data`, not nested under `order_details`.
   */
  const readAnswer = (key: string, over: Record<string, unknown> = {}) => ({
    status: 200,
    message: 'Successfully retrieved the order details',
    data: {
      id: 'o1', quote_ref: 'q1', actual_cost: '6000.00',
      quote_total: '6000.00', quote_complete: true, order_status: 'initiated',
      checkout_protocol: 3, quote_protocol: 2, quote_closure: null,
      accepted: false, accepted_at: null,
      checkout: {
        order_id: 'o1', intent_key: key,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: { state: 'not_accepted', outcome: null, quote_ref: null,
                      accepted_at: null },
        current: { order_status: 'initiated', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
      items: [] as unknown[], quote: [] as unknown[],
      ...over,
    },
  });

  /**
   * THE CONTRADICTION, built from the same read so only the two halves that
   * conflict differ: the projection says the order WAS accepted and the same
   * payload carries the closure saying its quote was retired.
   */
  const contradictoryAnswer = (key: string) => readAnswer(key, {
    order_status: 'pending', accepted: true,
    accepted_at: '2026-09-20T10:00:00Z',
    quote_closure: CLOSURE,
    checkout: {
      order_id: 'o1', intent_key: key,
      scope: { restaurant: 'r1', table: 't1' },
      acceptance: { state: 'accepted', outcome: 'newly_accepted',
                    quote_ref: 'q1', accepted_at: '2026-09-20T10:00:00Z' },
      current: { order_status: 'pending', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null },
      checkout_protocol: 3,
    },
  });

  function makeComponent(sidebar = true): ComponentFixture<BasketBodyComponent> {
    const fixture = TestBed.createComponent(BasketBodyComponent);
    // A routed instance runs `resumeInterruptedCheckout` on `ngOnInit`, which
    // is exactly how one of the two concurrent reads below is issued. Every
    // other mount here drives its own requests explicitly.
    fixture.componentInstance.sidebar = sidebar;
    return fixture;
  }

  /** The diner's own scoped read, selected by intent key. Matched on the
   *  REQUEST URL as the client actually builds it — `ApiService` appends the
   *  selector inline rather than through `HttpParams`. */
  const intentRead = () => (r: { url: string }) =>
    r.url.startsWith(`${V1}/orders/journey/order-details/`)
      && r.url.includes('intent=');

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
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
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: BasketService, useValue: basketService },
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
    http = TestBed.inject(HttpTestingController);
    coordinator = TestBed.inject(CheckoutCoordinatorService);
    storage = TestBed.inject(SessionStorageService);
    window.sessionStorage.setItem(
      'Table', JSON.stringify({ value: { id: 't1' } }));
    window.sessionStorage.setItem(
      'restaurant', JSON.stringify({ value: { id: 'r1' } }));
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    window.sessionStorage.removeItem('Table');
    window.sessionStorage.removeItem('restaurant');
  });

  // -- the schedule ------------------------------------------------------

  /**
   * K1/O1/Q1: price, review, confirm — and LOSE the acceptance reply. The
   * record is left `accepting` with the original command on it, which is the
   * only state from which a resend is reachable at all.
   *
   * A transport failure carries no body, so nothing is settled and nothing is
   * closed: the outcome is genuinely uncertain, which is the premise.
   */
  function anIssuedAcceptance() {
    const a = makeComponent();
    a.componentInstance.initiateOrder();
    // THE PREMISE: the unmodified fixture is an ordinarily confirmable,
    // ITEMISED quote, so every refusal below is attributable to the fault
    // under test rather than to a structurally rejected quote.
    const control = reviewQuote(correctedInitiate('o1', 'q1').data as any);
    expect(control.readable).withContext('readable quote').toBeTrue();
    expect(control.itemised).withContext('ITEMISED quote').toBeTrue();
    http.expectOne(INITIATE).flush(correctedInitiate('o1', 'q1'));
    const key = coordinator.record()!.key;
    a.componentInstance.confirmQuote();
    http.expectOne(SUBMIT)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
    return { a, key };
  }

  /** The realistic failing store: it accepts the write, throws nothing and
   *  keeps the previous value. `persist`'s read-back is what catches it. */
  function faultTheWrite(): void {
    spyOn(storage, 'setItem').and.stub();
  }

  // == H1. a recovery in flight when the hold arrives ====================

  describe('H1 — an authorized read already in flight', () => {
    /**
     * THE SCHEDULE. K1/O1/Q1, the table and the basket are unchanged
     * throughout; only the ORDER the two answers arrive in is the variable.
     *
     *   1. the acceptance is issued and its reply is lost
     *   2. B presses Retry BEFORE any hold exists. Its read is issued and
     *      HELD — the callback has not run and cannot have seen anything.
     *   3. a routed instance C resumes, reads the SAME key, and is answered
     *      with the server's valid closure. Only the LOCAL write fails, after
     *      the key and the command were successfully persisted — so the
     *      shared `unrecorded-closure` hold is established and the command is
     *      retained.
     *   4. B's older draft answer is released. Its captured owner still
     *      matches, because nothing about the attempt has moved.
     *
     * C's read is the startup one deliberately: it does not claim the
     * app-wide flight, so both reads can genuinely be open at once.
     */
    function twoReadsThenAHold() {
      const { key } = anIssuedAcceptance();

      // 2. B presses Retry first. Held, not answered.
      const b = makeComponent();
      b.componentInstance.retryOrder();
      const bRead = http.expectOne(intentRead());

      // 3. C resumes and is answered second, with the closure.
      const c = makeComponent(false);
      c.detectChanges();
      const cRead = http.expectOne(intentRead());
      faultTheWrite();
      cRead.flush(readAnswer(key, { quote_closure: CLOSURE }));

      return { b, c, key, bRead };
    }

    it('THE PREMISE: B`s read is outstanding before any hold exists', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      expect(coordinator.unresolvedClosure())
        .withContext('nothing is held at the press').toBeNull();
      b.componentInstance.retryOrder();
      const bRead = http.expectOne(intentRead());
      expect(bRead.cancelled).withContext('genuinely in flight').toBeFalse();
      bRead.flush(readAnswer(key));
      http.expectOne(SUBMIT).flush({ status: 200, message: 'ok' });
    });

    it('THE PREMISE: the hold is established while that read is open, and '
       + 'the command survives it', () => {
      const { key, bRead } = twoReadsThenAHold();

      const hold = coordinator.unresolvedClosure();
      expect(hold).withContext('the shared observation is established')
        .not.toBeNull();
      expect(hold!.kind).toBe('unrecorded-closure');
      expect(hold!.attempt.key).withContext('about THIS attempt').toBe(key);
      const record = coordinator.record()!;
      expect(record.key).withContext('same key').toBe(key);
      expect(record.command)
        .withContext('the original command is retained')
        .toEqual({ orderId: 'o1', quoteRef: 'q1' });
      expect(coordinator.closureOf(record).evidence.kind)
        .withContext('and nothing was persisted — that IS the situation')
        .toBe('absent');

      bRead.flush(readAnswer(key));
      http.match(() => true).forEach((r: TestRequest) => r.flush({}));
    });

    it('THE REGRESSION: releasing the older draft answer issues NO '
       + 'acceptance', () => {
      const { key, bRead } = twoReadsThenAHold();

      bRead.flush(readAnswer(key));

      http.expectNone(SUBMIT);
      expect(http.match(() => true).length)
        .withContext('no request of any kind follows the release').toBe(0);
    });

    it('THE REGRESSION: and it discards nothing — the command, the key and '
       + 'the hold all stand', () => {
      const { key, bRead } = twoReadsThenAHold();

      bRead.flush(readAnswer(key));

      const record = coordinator.record()!;
      expect(record.key).withContext('no new key was minted').toBe(key);
      expect(record.command)
        .withContext('the original command is not discarded')
        .toEqual({ orderId: 'o1', quoteRef: 'q1' });
      expect(record.stage).withContext('still outstanding').toBe('accepting');
      expect(coordinator.unresolvedClosure())
        .withContext('the hold still stands').not.toBeNull();
      expect(basketService.clearBasket)
        .withContext('the basket is not cleared').not.toHaveBeenCalled();
      http.match(() => true).forEach((r: TestRequest) => r.flush({}));
    });

    it('THE REGRESSION: the owned UI flight is released, so no surface is '
       + 'left spinning', () => {
      const { bRead, key } = twoReadsThenAHold();

      bRead.flush(readAnswer(key));

      expect(coordinator.inFlight())
        .withContext('`replayIssuedCommand` claimed it; something must give '
                     + 'it back').toBeFalse();
      http.match(() => true).forEach((r: TestRequest) => r.flush({}));
    });

    it('THE REGRESSION: and the refused mount shows the shared state rather '
       + 'than pretending the read failed', () => {
      const { b, bRead, key } = twoReadsThenAHold();

      bRead.flush(readAnswer(key));

      expect(b.componentInstance.closureUnresolved)
        .withContext('B reads the shared hold').toBeTrue();
      expect(b.componentInstance.checkoutBlocked).toBeTrue();
      expect(b.componentInstance.recoveryNotice)
        .withContext('and says something').not.toBeNull();
      http.match(() => true).forEach((r: TestRequest) => r.flush({}));
    });

    /**
     * THE SENTENCE IS PART OF THE REFUSAL, not decoration beside it.
     *
     * B's own read answered `draft`, and a `draft` on an outstanding record
     * says "Tap retry to send the same order again" — which under a hold is a
     * button `closureUnresolved` has already disabled. Promising an action the
     * state refuses is the shape this file has closed twice before, so the
     * shared hold outranks that one local result (and `absent`, which promises
     * the same thing) while every other sentence is left exactly as shipped.
     */
    it('THE REGRESSION: and it does not promise a Retry the hold refuses',
       () => {
      const { b, bRead, key } = twoReadsThenAHold();

      bRead.flush(readAnswer(key));

      const notice = b.componentInstance.recoveryNotice ?? '';
      expect(notice).not.toContain('Tap retry');
      expect(notice)
        .withContext('nor the same promise in the other wording')
        .not.toContain('send the same order again');
      expect(notice)
        .withContext('it names the situation the diner is actually in')
        .toContain('check with staff');
      http.match(() => true).forEach((r: TestRequest) => r.flush({}));
    });

    it('THE REGRESSION: an older ABSENT answer does not promise one either',
       () => {
      const { b, bRead } = twoReadsThenAHold();

      bRead.flush({ detail: 'Not found.' },
                  { status: 404, statusText: 'Not Found' });

      expect(b.componentInstance.recoveryNotice ?? '')
        .not.toContain('send the same order again');
      expect(http.match(() => true).length).toBe(0);
    });

    it('CONTROL: with NO hold, a draft still says the retry works — the hold '
       + 'is what changes the sentence, not the draft', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      b.componentInstance.retryOrder();
      http.expectOne(intentRead()).flush(readAnswer(key));

      expect(b.componentInstance.recoveryNotice ?? '')
        .withContext('the shipped sentence for an ordinary unconfirmed '
                     + 'acceptance is unchanged')
        .toContain('Tap retry');
      http.expectOne(SUBMIT).flush({ status: 200, message: 'ok' });
    });

    it('CONTROL: the sentences that already point at staff keep their own '
       + 'wording under a hold', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      b.componentInstance.retryOrder();
      const bRead = http.expectOne(intentRead());

      const c = makeComponent(false);
      c.detectChanges();
      const cRead = http.expectOne(intentRead());
      faultTheWrite();
      cRead.flush(readAnswer(key, { quote_closure: CLOSURE }));

      // An unreachable server, not a statement about the quote. `unknown`
      // already says "check with staff before ordering the same items again",
      // so the hold has nothing to correct and does not take the sentence.
      bRead.error(new ProgressEvent('error'),
                  { status: 0, statusText: 'Unknown' });

      expect((b.componentInstance as any).recovered.kind).toBe('unknown');
      expect(b.componentInstance.recoveryNotice)
        .toBe("We're still confirming your last order. Please check with "
              + 'staff before ordering the same items again.');
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE NULL OPERATION FAILS CLOSED: a hold applies to an answer whose '
       + 'record could not be read when it was issued', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, { quote_closure: { ...CLOSURE,
                                                  policy_version: 99 } }));
      expect(coordinator.unresolvedClosure()).not.toBeNull();

      // Nothing names an attempt, so nothing can be shown to be a DIFFERENT
      // attempt — which is exactly when a mutation must not go out.
      expect(coordinator.heldOperation(null))
        .withContext('a null operation is refused, never waved through')
        .not.toBeNull();
    });

    /** A commandless attempt, reused by the null-operation case above. */
    function aPricedAttempt() {
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate('o1', 'q1'));
      return { a, key: coordinator.record()!.key };
    }

    it('THE REGRESSION: an older ABSENT answer is refused the same way — the '
       + 'not-found rule is not weakened, the mutation is', () => {
      const { key, bRead } = twoReadsThenAHold();

      // 404: no row for this key at a scope the server resolved itself.
      bRead.flush({ detail: 'Not found.' },
                  { status: 404, statusText: 'Not Found' });

      http.expectNone(SUBMIT);
      const record = coordinator.record()!;
      expect(record.key)
        .withContext('NOT FOUND IS NOT PROOF OF NON-EXECUTION: the intent is '
                     + 'still not retired').toBe(key);
      expect(record.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE REGRESSION: an asserted-but-UNUSABLE hold refuses the resend '
       + 'too', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      b.componentInstance.retryOrder();
      const bRead = http.expectOne(intentRead());

      // C is answered with a policy version this build has never seen:
      // `unsupported`, NOT absent. Nothing may be acted on and nothing is
      // persisted, so the record still looks ordinary.
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(
        readAnswer(key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));
      expect(coordinator.unresolvedClosure()?.kind)
        .withContext('the other kind of hold').toBe('unusable-evidence');

      bRead.flush(readAnswer(key));

      http.expectNone(SUBMIT);
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE GATE ITSELF: the resend consumer refuses a held attempt when '
       + 'called directly, so a future caller cannot bypass it', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();

      // Establish the hold with no read of B's in flight at all, then call
      // the send site directly. This is the rule stated where the send is,
      // rather than at one caller of it.
      const c = makeComponent(false);
      c.detectChanges();
      const cRead = http.expectOne(intentRead());
      faultTheWrite();
      cRead.flush(readAnswer(key, { quote_closure: CLOSURE }));
      expect(coordinator.unresolvedClosure()).not.toBeNull();

      (b.componentInstance as any).resendIssuedCommand(
        { orderId: 'o1', quoteRef: 'q1' });

      http.expectNone(SUBMIT);
      expect(coordinator.inFlight())
        .withContext('and it claims no flight it will not give back')
        .toBeFalse();
      expect(http.match(() => true).length).toBe(0);
    });

    // -- the controls ---------------------------------------------------

    it('CONTROL: with NO hold, a draft answer still resends the EXACT '
       + 'original command', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      b.componentInstance.retryOrder();
      http.expectOne(intentRead()).flush(readAnswer(key));

      const resend = http.expectOne(SUBMIT);
      expect(resend.request.body)
        .withContext('the recorded command, never one rebuilt from the cart')
        .toEqual({ order: 'o1', quote_ref: 'q1' });
      resend.flush({ status: 200, message: 'ok' });
    });

    it('CONTROL: an ACCEPTED answer is still recoverable, and issues no '
       + 'second mutation', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      b.componentInstance.retryOrder();
      http.expectOne(intentRead()).flush(readAnswer(key, {
        order_status: 'pending', accepted: true,
        accepted_at: '2026-09-20T10:00:00Z',
        checkout: {
          order_id: 'o1', intent_key: key,
          scope: { restaurant: 'r1', table: 't1' },
          acceptance: { state: 'accepted', outcome: 'newly_accepted',
                        quote_ref: 'q1',
                        accepted_at: '2026-09-20T10:00:00Z' },
          current: { order_status: 'pending', fulfilment_status: 'new',
                     cancelled_at: null, served_at: null },
          checkout_protocol: 3,
        },
      }));

      expect((b.componentInstance as any).recovered.kind).toBe('accepted');
      http.expectNone(SUBMIT);
      expect(http.match(() => true).length).toBe(0);
    });

    it('CONTROL: a hold is NOT a durable closure — a later read that '
       + 'persists one supports ONE deliberate successor', () => {
      const { key, bRead } = twoReadsThenAHold();
      bRead.flush(readAnswer(key));
      expect(http.match(() => true).length).toBe(0);

      // The documented exit: storage recovers, the diner's own scoped read
      // finds the SAME published closure, and the write lands this time.
      (storage.setItem as jasmine.Spy).and.callThrough();
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, { quote_closure: CLOSURE }));

      const record = coordinator.record()!;
      expect(coordinator.closureOf(record).evidence.kind)
        .withContext('now it IS established').toBe('closure');
      expect(coordinator.unresolvedClosure())
        .withContext('and the observation yields to the durable fact')
        .toBeNull();

      const renewal = coordinator.renewAfterClosure();
      expect(renewal.kind)
        .withContext('ONE successor, from the verified durable closure')
        .toBe('ready');
    });
  });

  // == H2. a contradictory answer ========================================

  describe('H2 — the projection says accepted AND closed', () => {
    /** A commandless attempt: priced and reviewed, nothing issued. This is
     *  the shape whose replayable INITIATION the second mount would re-send. */
    function aPricedAttempt() {
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE).flush(correctedInitiate('o1', 'q1'));
      return { a, key: coordinator.record()!.key };
    }

    it('THE PREMISE: the receiving mount blocks itself and the shared record '
       + 'says nothing', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      expect((c.componentInstance as any).recovered.kind).toBe('inconsistent');
      expect(c.componentInstance.closureUnresolved).toBeTrue();
      const record = coordinator.record()!;
      expect(record.key).withContext('preserved, not rewritten').toBe(key);
      expect(record.stage).toBe('reviewing');
      expect(coordinator.closureOf(record).evidence.kind)
        .withContext('neither half is persisted — that IS the mechanism')
        .toBe('absent');
      expect(basketService.clearBasket).not.toHaveBeenCalled();
    });

    it('THE REGRESSION: the OTHER live mount reports the same hold', () => {
      const { key } = aPricedAttempt();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      expect(b.componentInstance.closureUnresolved)
        .withContext('B has neither C`s `recovered` nor a persisted closure')
        .toBeTrue();
      expect(b.componentInstance.checkoutBlocked).toBeTrue();
      expect(b.componentInstance.recoveryNotice)
        .withContext('and explains itself rather than showing a dead button')
        .not.toBeNull();
    });

    it('THE REGRESSION: B`s own Retry re-issues no initiation', () => {
      const { key } = aPricedAttempt();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      b.componentInstance.retryOrder();

      http.expectNone(INITIATE);
      http.expectNone(SUBMIT);
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key)
        .withContext('and no second key').toBe(key);
    });

    it('THE REGRESSION: and B`s own Checkout press mints no replacement',
       () => {
      const { key } = aPricedAttempt();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      b.componentInstance.initiateOrder();

      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.key).toBe(key);
    });

    it('THE REGRESSION: the coordinator`s own shared decisions refuse it, '
       + 'not merely the getters', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      const record = coordinator.record()!;
      expect(coordinator.isReplayableInitiation(record))
        .withContext('no initiation replay').toBeFalse();
      expect(coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' }))
        .withContext('no acceptance is recorded, so none is issued')
        .toBeFalse();
      expect(coordinator.reserveIntent(record.request, record.scope).kind)
        .withContext('and neither branch of reservation').toBe('held');
      // `unusable`, NOT `storage-error`: nothing here failed to write. The
      // row beside the acceptance may be perfectly readable — what may not be
      // acted on is the PAIR — and `unusable` is the word the consumer
      // already answers with manual recovery rather than "we could not save
      // that on this device".
      expect(coordinator.renewAfterClosure().kind)
        .withContext('and no successor for a contradiction').toBe('unusable');
    });

    it('THE REGRESSION: with a RETAINED ISSUED COMMAND, B`s Retry sends no '
       + 'acceptance', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      b.componentInstance.retryOrder();

      http.expectNone(SUBMIT);
      expect(http.match(() => true).length).toBe(0);
      expect(coordinator.record()!.command)
        .withContext('and the command is preserved, not discarded')
        .toEqual({ orderId: 'o1', quoteRef: 'q1' });
    });

    it('THE REGRESSION: a mount created AFTER the observation is held too',
       () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      const d = makeComponent();
      expect(d.componentInstance.closureUnresolved).toBeTrue();
      d.componentInstance.retryOrder();
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE REGRESSION: destroying the receiving mount does not release the '
       + 'protection', () => {
      const { key } = aPricedAttempt();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      c.destroy();

      expect(b.componentInstance.closureUnresolved)
        .withContext('the observation is shared state, not a field on C')
        .toBeTrue();
      b.componentInstance.retryOrder();
      expect(http.match(() => true).length).toBe(0);
    });

    it('THE REASON DISTINCTION: a contradiction is kept apart from a '
       + 'coherent unsupported closure and from an unrecorded one', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      const hold = coordinator.unresolvedClosure()!;
      expect(hold.kind)
        .withContext('NOT `unrecorded-closure` — nothing was read that could '
                     + 'be written, and NOT `unusable-evidence` — the closure '
                     + 'itself is perfectly readable')
        .toBe('contradictory-evidence');
      expect(hold.attempt.key).withContext('bound to the attempt').toBe(key);
    });

    /**
     * CODEX P2 ON PR #679, VALID — AND A REGRESSION OF THIS CHANGE.
     *
     * `holdClosure` is LAST WRITE WINS, and its own safety argument was
     * "both kinds refuse the same mutations, so a second observation about
     * the same attempt cannot weaken the first". Adding a third kind made
     * that false and left it standing: `contradictory-evidence` alone
     * withholds the durable-closure yield, so an ordinary hold recorded for
     * the SAME attempt afterwards is a DOWNGRADE — and a durable closure
     * then releases a situation whose acceptance half nobody resolved,
     * letting `renewAfterClosure` mint a successor for an order the server
     * said was accepted. That is the irreversible half of the contradiction,
     * reached through the one door the kind was introduced by.
     *
     * TWO READS DISAGREEING ABOUT ACCEPTANCE IS THE FIXTURE, and it is
     * defensive territory by construction — so is `inconsistent` itself. The
     * subject is the REPLACEMENT RULE, not the server's coherence.
     */
    it('THE REGRESSION: an ordinary hold never downgrades a contradiction '
       + 'about the same attempt', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      expect(coordinator.unresolvedClosure()!.kind)
        .toBe('contradictory-evidence');

      // A second mount's read answers NOT accepted, with a closure this
      // build may not act on — an ordinary `unusable-evidence` observation
      // about the very same attempt.
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead()).flush(
        readAnswer(key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));

      expect(coordinator.unresolvedClosure()!.kind)
        .withContext('the stronger observation stands; it refuses strictly '
                     + 'more than the one that arrived after it')
        .toBe('contradictory-evidence');
    });

    it('THE REGRESSION: so a durable closure still does not release it, and '
       + 'no successor is minted', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead()).flush(
        readAnswer(key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));

      // The durable closure that an ordinary hold WOULD have yielded to.
      expect(coordinator.noteClosure({
        closedAt: CLOSURE.closed_at, reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 1,
      } as any)).withContext('the write itself is unaffected').toBeTrue();

      expect(coordinator.unresolvedClosure())
        .withContext('the contradiction survives the downgrade attempt AND '
                     + 'the closure').not.toBeNull();
      expect(coordinator.renewAfterClosure().kind)
        .withContext('so no successor for an order the server said was '
                     + 'accepted').not.toBe('ready');
    });

    it('CONTROL: a contradiction DOES replace an ordinary hold — the guard '
       + 'is one-way, and an upgrade must still land', () => {
      const { key } = aPricedAttempt();
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead()).flush(
        readAnswer(key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));
      expect(coordinator.unresolvedClosure()!.kind).toBe('unusable-evidence');

      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      expect(coordinator.unresolvedClosure()!.kind)
        .withContext('a contradiction refuses strictly more, so it applies')
        .toBe('contradictory-evidence');
    });

    it('CONTROL: a FRESHER contradiction replaces an older one, so the '
       + 'evidence on screen is the latest read', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      expect(coordinator.unresolvedClosure()!.evidence)
        .toEqual(jasmine.objectContaining({ kind: 'closure' }));
      const first = coordinator.unresolvedClosure()!;

      // A second read of the same contradictory situation, naming the other
      // closure reason. Both refuse identically, so the guard must not keep
      // the stale one.
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(key, {
        order_status: 'pending', accepted: true,
        accepted_at: '2026-09-20T10:00:00Z',
        quote_closure: { ...CLOSURE, reason: 'purchase_needs_review' },
        checkout: {
          order_id: 'o1', intent_key: key,
          scope: { restaurant: 'r1', table: 't1' },
          acceptance: { state: 'accepted', outcome: 'newly_accepted',
                        quote_ref: 'q1',
                        accepted_at: '2026-09-20T10:00:00Z' },
          current: { order_status: 'pending', fulfilment_status: 'new',
                     cancelled_at: null, served_at: null },
          checkout_protocol: 3,
        },
      }));

      const now = coordinator.unresolvedClosure()!;
      expect(now.kind)
        .withContext('still a contradiction').toBe('contradictory-evidence');
      expect(now).not
        .withContext('but the FRESHER observation, not the one it replaced')
        .toBe(first);
      expect((now.evidence as any).closure?.reason)
        .withContext('carrying what the latest read actually said')
        .toBe('purchase_needs_review');
    });

    it('CONTROL: an ordinary hold still replaces an ordinary hold', () => {
      const { key } = aPricedAttempt();
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead()).flush(
        readAnswer(key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));
      expect(coordinator.unresolvedClosure()!.kind).toBe('unusable-evidence');

      // The existing last-write-wins behaviour between the two ordinary
      // kinds is untouched: they DO refuse the same mutations.
      coordinator.holdClosure({
        kind: 'unrecorded-closure',
        attempt: { key, scope: 'r1:t1',
                   purchase: basketService.contentIdentity() },
        orderId: 'o1',
        evidence: { kind: 'absent' },
      });
      expect(coordinator.unresolvedClosure()!.kind).toBe('unrecorded-closure');
    });

    it('A DURABLE CLOSURE DOES NOT RESOLVE A CONTRADICTION BY ITSELF', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));

      // A closure lands on the record from somewhere — the other mount's
      // submit refusal, say. It records the RETIRED half; it says nothing
      // about the acceptance the same response claimed, and the order may be
      // in the kitchen. Yielding here would offer a successor for it.
      expect(coordinator.noteClosure({
        closedAt: CLOSURE.closed_at, reason: 'quote_expired',
        quoteRef: 'q1', policyVersion: 1,
      } as any)).withContext('the write itself is unaffected').toBeTrue();

      expect(coordinator.unresolvedClosure())
        .withContext('the contradiction still stands').not.toBeNull();
      expect(coordinator.renewAfterClosure().kind)
        .withContext('and no successor is minted for it').not.toBe('ready');
    });

    it('A LATER COHERENT ANSWER RESOLVES IT, under the existing ownership '
       + 'rules', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      expect(coordinator.unresolvedClosure()).not.toBeNull();

      // A fresh authorized read of the same attempt, issued AFTER the
      // contradiction, and coherent this time: not accepted, closed.
      const d = makeComponent(false);
      d.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, { quote_closure: CLOSURE }));

      expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
        .withContext('the coherent half is durably recorded').toBe('closure');
      expect(coordinator.unresolvedClosure())
        .withContext('and the contradiction is resolved by it').toBeNull();
      expect(coordinator.renewAfterClosure().kind)
        .withContext('the ordinary successor path is available again')
        .toBe('ready');
    });

    it('A STALE ANSWER CANNOT CLEAR A NEWER CONTRADICTION merely by landing '
       + 'later', () => {
      const { key } = aPricedAttempt();

      // D's coherent read is issued FIRST and held.
      const d = makeComponent(false);
      d.detectChanges();
      const dRead = http.expectOne(intentRead());

      // The contradiction is observed while it is open.
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(contradictoryAnswer(key));
      expect(coordinator.unresolvedClosure()!.kind)
        .toBe('contradictory-evidence');

      // D's OLDER answer lands last. It describes a moment before the
      // contradiction was seen, so it may not speak for what came after it.
      dRead.flush(readAnswer(key, { quote_closure: CLOSURE }));

      expect(coordinator.unresolvedClosure())
        .withContext('the newer observation stands').not.toBeNull();
      expect(coordinator.unresolvedClosure()!.kind)
        .toBe('contradictory-evidence');
    });

    // -- the controls ---------------------------------------------------

    it('CONTROL: an ORDINARY accepted answer holds nothing and finishes the '
       + 'checkout', () => {
      const { key } = aPricedAttempt();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(key, {
        order_status: 'pending', accepted: true,
        accepted_at: '2026-09-20T10:00:00Z',
        checkout: {
          order_id: 'o1', intent_key: key,
          scope: { restaurant: 'r1', table: 't1' },
          acceptance: { state: 'accepted', outcome: 'newly_accepted',
                        quote_ref: null,
                        accepted_at: '2026-09-20T10:00:00Z' },
          current: { order_status: 'pending', fulfilment_status: 'new',
                     cancelled_at: null, served_at: null },
          checkout_protocol: 3,
        },
      }));

      expect(coordinator.unresolvedClosure())
        .withContext('an accepted order is not a closure situation').toBeNull();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
    });

    it('CONTROL: an ORDINARY draft answer holds nothing and leaves B free',
       () => {
      const { key } = aPricedAttempt();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead()).flush(readAnswer(key));

      expect(coordinator.unresolvedClosure()).toBeNull();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
      expect(coordinator.isReplayableInitiation(coordinator.record()!))
        .withContext('an ordinary commandless draft is still replayable')
        .toBeTrue();
    });

    it('CONTROL: an ordinary SUPPORTED closure still persists and still '
       + 'supports a successor', () => {
      const { key } = aPricedAttempt();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, { quote_closure: CLOSURE }));

      expect(coordinator.unresolvedClosure())
        .withContext('a closure that WAS written down holds nothing')
        .toBeNull();
      expect(coordinator.renewAfterClosure().kind).toBe('ready');
    });

    it('CONTROL: a genuinely OLD server is not held by its silence', () => {
      // LEVEL 1 THROUGHOUT, and that is the whole control. Pricing at level 2
      // and then reading level 1 is a DOWNGRADE, which E1b calls
      // `malformed('level')` — a real refusal, and not the compatibility this
      // case is named for. The level is remembered per attempt, so the
      // initiate has to state it too.
      const a = makeComponent();
      a.componentInstance.initiateOrder();
      http.expectOne(INITIATE)
        .flush(correctedInitiate('o1', 'q1', { quote_protocol: 1 }));
      const key = coordinator.record()!.key;

      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead())
        .flush(readAnswer(key, { quote_protocol: 1 }));

      expect(coordinator.unresolvedClosure()).toBeNull();
      expect(b.componentInstance.closureUnresolved).toBeFalse();
    });

    it('CONTROL: ordinary network uncertainty is NOT a hold, and keeps its '
       + 'real Retry', () => {
      const { key } = anIssuedAcceptance();
      const b = makeComponent();
      const c = makeComponent(false);
      c.detectChanges();
      http.expectOne(intentRead())
        .error(new ProgressEvent('error'),
               { status: 0, statusText: 'Unknown' });

      expect(coordinator.unresolvedClosure())
        .withContext('nothing was asserted about the quote').toBeNull();
      expect(b.componentInstance.closureUnresolved).toBeFalse();

      b.componentInstance.retryOrder();
      const retryRead = http.expectOne(intentRead());
      retryRead.flush(readAnswer(key));
      http.expectOne(SUBMIT).flush({ status: 200, message: 'ok' });
    });
  });
});
