/**
 * C1 — A LOST CLOSURE RESPONSE MUST NOT BECOME A DEAD END.
 *
 * THE CYCLE THIS REPRODUCES, step by step, and why each step is forced:
 *
 *   1. the diner prices a basket   -> K1 reserved, O1/Q1 reviewed
 *   2. the diner presses Place order -> the command {O1,Q1} is recorded and
 *      the acceptance is sent
 *   3. the SERVER commits a closure for Q1 and refuses — and the REPLY IS
 *      LOST. That is the one response D06 was built around losing.
 *   4. the record is left `accepting` with an outstanding command
 *   5. a reload asks the authorized read what K1 resolved to. The server
 *      answers with the order: still `initiated`, `acceptance.state`
 *      `not_accepted`, and — at `quote_protocol` 2 — the CLOSURE it wrote in
 *      step 3, published exactly so a client that lost the refusal can learn
 *      its quote is finished WITHOUT attempting an acceptance to find out.
 *   6. `classify()` is the D04 acceptance-only classifier: it reads the
 *      acceptance verdict and nothing else, so it answers `draft`. `draft` is
 *      proof-of-non-execution, so `replayIssuedCommand` RE-SENDS the same
 *      acceptance — which the server refuses identically, and
 *      `resendIssuedCommand` files every error as `unknown`.
 *
 * Tap Retry and you are back at step 5. The record can never be settled, the
 * CTA never returns to Checkout, and the diner has no in-app escape — which
 * is precisely the failure G3b's renewal primitive exists to end, reached
 * through the one path G3b did not cover.
 *
 * WHAT THESE SPECS DRIVE. The real `ApiService`, the real `HttpClient` and the
 * real `ErrorInterceptor` (the 400-with-a-reason forward and the `intent=`
 * carve-out are both load-bearing here), the real coordinator over real
 * session storage, and the real component. A spy `ApiService` cannot show this
 * cycle: it is the interaction between what the read publishes, what the
 * classifier reads and what the retry consumer then does.
 *
 * THE POSITIVE CONTROLS MATTER AS MUCH AS THE FAILURES. A `not_accepted` read
 * with no closure is an ORDINARY unconfirmed acceptance and must go on
 * re-sending the recorded command; an ACCEPTED order that also carries a
 * closure is accepted (the closure is about the quote, not about whether the
 * submission landed); and a closure a server never promised to publish is not
 * a verdict. Each is asserted beside the regression so a fix cannot buy the
 * headline case by breaking those.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import {
  HttpTestingController, provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';

import { environment } from 'src/environments/environment';
import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX }
  from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService, PURCHASE_CANON,
} from '../../../_services/checkout-coordinator.service';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — a lost closure response (D06/C1)', () => {
  let http: HttpTestingController;
  let basket: { items: BasketItem[]; totalAmount: number };
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const API = `${environment.apiUrl}/api`;
  const V1 = `${API}/${environment.version}`;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  /** The closure the server wrote in step 3 — a real one, fully formed. */
  const CLOSURE = {
    closed_at: '2026-09-18T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
  };

  /** An initiate 200. */
  const initiated = (details: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o1', quote_ref: 'q1', actual_cost: '5000.00',
        quote_total: '5000.00', pricing_version: 'CORRECTED',
        checkout_protocol: 3, quote_protocol: 2,
        ...details,
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
      quote: [], quote_total: '5000.00',
    },
  });

  /**
   * The authorized read's answer for a key.
   *
   * FLAT UNDER `data`, which is what the server actually sends: the read is
   * `SerializerPublicOrderDetails`, a `ModelSerializer` whose `checkout`,
   * `checkout_protocol`, `quote_protocol` and `quote_closure` are its own
   * fields. Only the INITIATE response nests its order under `order_details`
   * (`con_orders` builds that envelope by hand), and the two shapes are
   * deliberately kept distinct here rather than shared, because a fixture
   * that flattened both would pass against a client reading either.
   */
  const readAnswer = (
    key: string,
    over: Record<string, unknown> = {},
    acceptance: Record<string, unknown> = { state: 'not_accepted' },
  ) => ({
    status: 200,
    message: 'Successfully retrieved the order details',
    data: {
      id: 'o1', quote_ref: 'q1', actual_cost: '5000.00',
      quote_total: '5000.00', quote_complete: true, order_status: 'initiated',
      checkout_protocol: 3, quote_protocol: 2, quote_closure: null,
      accepted: false, accepted_at: null,
      checkout: {
        order_id: 'o1',
        intent_key: key,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: { outcome: null, quote_ref: null, accepted_at: null,
                      ...acceptance },
        current: { order_status: 'initiated', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
      items: [] as unknown[], quote: [] as unknown[],
      ...over,
    },
  });

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
    // The table session the whole diner journey is scoped to. Seeded BEFORE
    // the component is created — `refreshTableContext` runs in the
    // constructor, and the scope it reads is what `correlationMatches`
    // compares the server's resolved scope against.
    window.sessionStorage.setItem(
      'Table', JSON.stringify({ value: { id: 't1' } }));
    window.sessionStorage.setItem(
      'restaurant', JSON.stringify({ value: { id: 'r1' } }));
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
    // Every case below drives recovery itself, so the routed instance's own
    // resume must not consume a request first.
    component.sidebar = true;
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    window.sessionStorage.removeItem('Table');
    window.sessionStorage.removeItem('restaurant');
  });

  // -- the six steps, driven for real -----------------------------------

  /** Steps 1-2: price, review and issue the acceptance. Returns K1. */
  function priceAndAccept(): string {
    component.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    const key = coordinator.record()!.key;
    component.confirmQuote();
    return key;
  }

  /** Step 3: the acceptance commits a closure server-side and the reply is
   *  LOST. A transport failure carries no body at all, which is exactly what
   *  makes it different from a refusal the client can read. */
  function loseTheReply(): void {
    http.expectOne(`${V1}/orders/submit/`)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
  }

  /** Step 5: what the authorized read answers afterwards. */
  function answerTheRead(body: object): void {
    // `ApiService.get` builds the query INTO the url string rather than
    // through `HttpParams`, so the match is on the url itself.
    const found = http.expectOne(
      (r) => r.url.startsWith(`${V1}/orders/journey/order-details/`)
        && r.url.includes('intent='));
    found.flush(body);
  }

  it('THE PREMISE: the acceptance is issued and its reply is lost', () => {
    const key = priceAndAccept();
    loseTheReply();

    const record = coordinator.record()!;
    expect(record.key).toBe(key);
    expect(record.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
    expect(coordinator.isOutstanding(record)).toBeTrue();
  });

  it('THE REGRESSION: a reload that reads the published closure does NOT '
     + 'report an ordinary draft', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    // The order really is still `initiated` and really was never accepted —
    // but it ALSO carries the server's durable statement that its quote can
    // never be accepted. Reporting that as a plain draft is what makes the
    // re-send below inevitable.
    expect((component as any).recovered.kind).not.toBe('draft');
  });

  it('THE REGRESSION: and it does not re-send the acceptance the server has '
     + 'already permanently refused', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    // A second `orders/submit/` here is the dead end: the server closed the
    // quote, so this request can only ever be refused, and its refusal files
    // as `unknown` and offers Retry again.
    http.expectNone(`${V1}/orders/submit/`);
  });

  it('THE REGRESSION: the diner is offered a way out, not another Retry',
     () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    const notice = component.recoveryNotice ?? '';
    expect(notice).not.toBe('');
    // "Tap retry to send the same order again" is the sentence the draft
    // branch produces, and it is a promise this state cannot keep.
    expect(notice.toLowerCase()).not.toContain('retry');
  });

  it('THE REGRESSION: and the loop is actually broken — nothing is ever '
     + 'priced again under the key the closure was written against', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));
    expect((component as any).recovered.kind).not.toBe('draft');

    // A second press of ANY checkout entry must not re-send the dead
    // acceptance, and must not re-price under the dead key either: that key
    // names the order the closure was written against, so an initiate under
    // it replays exactly the order that can never be paid.
    component.retryOrder();
    http.expectNone(`${V1}/orders/submit/`);
    const priced = http.match(`${API}/v2/orders/initiate/`);
    priced.forEach((r) => {
      expect((r.request.body as any).client_order_id).not.toBe(key);
      r.flush(initiated());
    });
  });

  // -- the controls a fix must not buy the headline case by breaking -----

  it('CONTROL: an unconfirmed acceptance with NO closure still re-sends the '
     + 'recorded command', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key));

    // `not_accepted` with nothing else to say is the ordinary lost-acceptance
    // case, and D04 closed it by re-sending the SAME command under the SAME
    // key. Nothing here may narrow that.
    const resent = http.expectOne(`${V1}/orders/submit/`);
    expect(resent.request.body).toEqual({ order: 'o1', quote_ref: 'q1' });
    resent.flush({ status: 200, message: 'ok' });
  });

  it('E1: an ACCEPTED order that ALSO carries a closure is INCONSISTENT',
     () => {
    // CHANGED EXPECTATION, DELIBERATELY. This asserted `accepted` on the
    // reasoning that a closure is about the QUOTE, so an order accepted
    // before one was written is still accepted. The premise is sound and the
    // conclusion does not follow: the server cannot produce this pair.
    // `quote_closure.close` refuses to write a closure beside acceptance
    // evidence and the acceptance path resolves evidence FIRST, so one order
    // carries at most one of the two.
    //
    // Choosing the acceptance half is not free. It CLEARS THE BASKET AND
    // DELETES THE RECORD, on a response whose other half says the quote was
    // retired — and if the closure is the true half, the diner has lost both
    // their basket and the only handle that could resolve it. Choosing the
    // closure half would mint a replacement for an order that may be cooking.
    // So neither is chosen.
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(
      key,
      { quote_closure: CLOSURE, accepted: true,
        accepted_at: '2026-09-18T09:59:00Z' },
      { state: 'accepted', outcome: null, quote_ref: 'q1',
        accepted_at: '2026-09-18T09:59:00Z' },
    ));

    expect((component as any).recovered.kind).toBe('inconsistent');
    // NOTHING IS ANNOUNCED, MINTED OR ERASED.
    http.expectNone(`${V1}/orders/initiate/`);
    expect(coordinator.record()).not.toBeNull();
    expect(coordinator.record()!.key).toBe(key);
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(component.checkoutBlocked).toBeTrue();
    expect(component.recoveryNotice).toContain('check with staff');
  });

  it('CONTROL: an ACCEPTED order with NO closure is still accepted', () => {
    // The half that must not move. Without the contradiction the acceptance
    // is announced exactly as before.
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(
      key,
      { accepted: true, accepted_at: '2026-09-18T09:59:00Z' },
      { state: 'accepted', outcome: null, quote_ref: 'q1',
        accepted_at: '2026-09-18T09:59:00Z' },
    ));

    expect((component as any).recovered.kind).toBe('accepted');
    http.expectNone(`${V1}/orders/initiate/`);
  });

  // -- the resend is refused by the same server ---------------------------

  it('THE REGRESSION: a RESEND refused with the closure is settled, not '
     + 'filed as unknown', () => {
    const key = priceAndAccept();
    loseTheReply();

    // The read says the draft is intact, so D04 re-sends the recorded
    // command — and THAT is where the server states the closure.
    component.retryOrder();
    answerTheRead(readAnswer(key));
    http.expectOne(`${V1}/orders/submit/`).flush(
      { status: 400, message: 'refused', reason: 'quote_expired',
        quote_closure: CLOSURE },
      { status: 400, statusText: 'Bad Request' });

    // This handler filed EVERY failure as `unknown`, leaving the command
    // outstanding and the CTA offering a Retry that arrives back here.
    expect((component as any).recovered.kind).toBe('closed');
    expect(coordinator.record()!.command).toBeNull();
    const reading = coordinator.closureOf(coordinator.record()!);
    expect(reading.evidence.kind === 'closure'
      && reading.evidence.closure).toEqual({
      closedAt: CLOSURE.closed_at, reason: CLOSURE.reason,
      quoteRef: CLOSURE.quote_ref, policyVersion: CLOSURE.policy_version,
    });
    // O1 — AND IT NAMES THE ATTEMPT IT WAS WRITTEN AGAINST.
    expect(reading.predecessor?.key).toBe(coordinator.record()!.key);
    expect(component.updatedReviewPrompt).not.toBeNull();
  });

  it('CONTROL: a resend refused with NO closure stays unresolved', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key));
    http.expectOne(`${V1}/orders/submit/`).flush(
      { status: 400, message: 'refused', reason: 'quote_expired' },
      { status: 400, statusText: 'Bad Request' });

    // The word without the row settles nothing — the command stays
    // recoverable and no closure is invented.
    expect((component as any).recovered.kind).toBe('unknown');
    expect(coordinator.record()!.command).not.toBeNull();
    expect(coordinator.record()!.closure).toBeNull();
  });

  // -- O1: the two RECOVERY writes are required, and were unpinned --------
  //
  // THE GAP THIS CLOSES WAS FOUND BY MUTATION, NOT BY READING. Both recovery
  // consumers already checked `noteClosure`'s return, and removing BOTH checks
  // failed nothing in 2497 specs — so the rule was stated in code and in a
  // comment and pinned by neither. A closure that cannot be written down is
  // not an established fact: the sidebar, the next reload and the diner's
  // explicit review would each read a record that says nothing about a
  // closure, and the review would then find none and price again under the
  // retired key. The submit-refusal path has its own gate in
  // `basket-body.evidence-gates.spec.ts`; these are the other two sites.

  it('O1: a Retry whose closure cannot be written down claims nothing', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    // A store that ACCEPTS `setItem`, throws nothing and keeps the previous
    // value is the realistic failure — which is why `persist` verifies by
    // read-back rather than by try/catch.
    spyOn(window.sessionStorage, 'setItem').and.stub();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    expect((component as any).recovered.kind).toBe('unknown');
    // NOTHING IS CLAIMED AND NOTHING IS LOST: no review is offered, and the
    // command stays outstanding so a later read can still settle it.
    expect(component.updatedReviewPrompt).toBeNull();
    expect(coordinator.record()!.command).not.toBeNull();
    // And no successor is minted on the strength of an unwritten closure.
    http.expectNone(`${API}/v2/orders/initiate/`);
  });

  it('O1: and the STARTUP read applies the same rule', () => {
    const key = priceAndAccept();
    loseTheReply();

    // The routed instance resumes in `ngOnInit`. A second component over the
    // SAME persisted record is what drives that path here, since the fixture
    // above deliberately suppresses its own resume.
    const resumed = TestBed.createComponent(BasketBodyComponent);
    spyOn(window.sessionStorage, 'setItem').and.stub();
    resumed.detectChanges();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    expect((resumed.componentInstance as any).recovered.kind).toBe('unknown');
    expect(resumed.componentInstance.updatedReviewPrompt).toBeNull();
    expect(coordinator.record()!.command).not.toBeNull();
  });

  it('CONTROL: when the write DOES land, the review is offered', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    // The half a fix must not buy the two above by breaking.
    expect((component as any).recovered.kind).toBe('closed');
    expect(component.updatedReviewPrompt).not.toBeNull();
    expect(coordinator.record()!.command).toBeNull();
  });

  it('CONTROL: a closure from a server that never promised to publish one is '
     + 'not a verdict', () => {
    // FIXTURE CORRECTED, RULE UNCHANGED. This used to price through
    // `priceAndAccept()`, whose initiate declares `quote_protocol: 2` — so
    // the record remembered level 2 for this attempt and the read's level 1
    // was a DOWNGRADE, not an older server. `readPublishedClosure` has called
    // that `malformed('level')` since E1b; `closedOr` merely swallowed it to
    // `draft`, which is the defect the two regressions above close, and this
    // control was passing on that swallow rather than on the compatibility it
    // names. The downgrade keeps its own test below.
    //
    // A server that NEVER promised states level 1 THROUGHOUT, and that is the
    // case this control is for: `quote_protocol: 1` retires quotes durably
    // but announces them only on the refusal, so a `quote_closure` on its
    // read is not something it ever said it would send. Reading it as a
    // verdict would make an older backend look like it was answering a
    // question it has never been asked.
    component.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`)
      .flush(initiated({ quote_protocol: 1 }));
    const key = coordinator.record()!.key;
    component.confirmQuote();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(
      key, { quote_protocol: 1, quote_closure: CLOSURE }));

    const resent = http.expectOne(`${V1}/orders/submit/`);
    resent.flush({ status: 200, message: 'ok' });
  });

  it('THE REGRESSION: a server that DEMONSTRATED level 2 and then answers '
     + 'below it is broken, not old', () => {
    // The other half of the fixture above, kept explicit so the distinction
    // cannot be lost again. The level is remembered per attempt and
    // monotonically — a capability does not un-demonstrate itself — so this
    // read is this server failing a promise it made, and reading it as "no
    // closure" would re-send the acceptance for a quote that may be retired.
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(
      key, { quote_protocol: 1, quote_closure: CLOSURE }));

    http.expectNone(`${V1}/orders/submit/`);
    expect((component as any).recovered.kind).toBe('closure-unreadable');
    expect(coordinator.record()!.key).toBe(key);
    expect(component.checkoutBlocked).toBeTrue();
  });

  // ====================================================================
  // E1 — ASSERTED BUT UNUSABLE IS NOT ABSENT, AT THE RECOVERY CONSUMER
  //
  // `closedOr` promoted a draft verdict to `closed` only for a VALID
  // closure and handed back the `draft` fallback for every other kind. Two
  // of those kinds are not absence: `unsupported` (a policy version this
  // build has never seen) and `malformed` (including one naming a different
  // quote). The server recorded SOMETHING under `quote_closure`, and `draft`
  // is proof of non-execution — so `replayIssuedCommand` re-sent the
  // acceptance for a quote that may already be retired, the server refused
  // it identically, the refusal filed as `unknown`, and Retry returned here.
  //
  // The rule is E1's own and it is stated in the approval: a malformed or
  // wrong-reference closure is never permission to treat the quote as open,
  // resend an acceptance, discard evidence or create another intent.
  // (Codex P2 on PR #676, valid.)
  // ====================================================================

  it('THE REGRESSION: an UNSUPPORTED-policy closure beside a draft does NOT '
     + 'resend the acceptance', () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(
      key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));

    // NOT a draft, and above all no second acceptance.
    http.expectNone(`${V1}/orders/submit/`);
    expect((component as any).recovered.kind).toBe('closure-unreadable');
    // NOTHING IS MINTED, SETTLED OR ERASED: the last usable attempt is kept.
    http.expectNone(`${API}/v2/orders/initiate/`);
    expect(coordinator.record()!.key).toBe(key);
    expect(coordinator.record()!.command).toEqual(
      { orderId: 'o1', quoteRef: 'q1' });
    expect(coordinator.closureOf(coordinator.record()!).evidence.kind)
      .toBe('absent');
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    // AND THE DINER IS TOLD, with the one remedy this build can name.
    expect(component.checkoutBlocked).toBeTrue();
    expect(component.recoveryNotice).toContain('check with staff');
    expect(component.updatedReviewPrompt).toBeNull();
  });

  it('THE REGRESSION: a closure naming ANOTHER quote does not resend either',
     () => {
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(
      key, { quote_closure: { ...CLOSURE, quote_ref: 'some-other-quote' } }));

    http.expectNone(`${V1}/orders/submit/`);
    expect((component as any).recovered.kind).toBe('closure-unreadable');
    expect(coordinator.record()!.key).toBe(key);
  });

  it('CONTROL: a VALID closure is still the `closed` verdict', () => {
    // The discriminating half — same shape, policy 1, this attempt's quote.
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key, { quote_closure: CLOSURE }));

    expect((component as any).recovered.kind).toBe('closed');
    expect(component.updatedReviewPrompt).not.toBeNull();
  });

  it('CONTROL: NO closure is still an ordinary draft that re-sends', () => {
    // The other discriminating half, and the one a careless fix breaks: an
    // absent closure must keep D04's proof-of-non-execution re-send.
    const key = priceAndAccept();
    loseTheReply();

    component.retryOrder();
    answerTheRead(readAnswer(key));

    const resent = http.expectOne(`${V1}/orders/submit/`);
    expect(resent.request.body).toEqual({ order: 'o1', quote_ref: 'q1' });
    resent.flush({ status: 200, message: 'ok' });
  });

  // ====================================================================
  // E1 — AND THE CONTRADICTION GATE REACHES THE LEGACY ACCEPTED PATH
  //
  // The two protocol levels are INDEPENDENT by design: `quote_protocol`
  // says whether closures are published, `checkout_protocol` whether the
  // correlated projection is. So a server answering below level 3 while
  // publishing a level-2 closure is exactly the shape the accepted-and-
  // closed gate exists for — and that gate ran only inside the level-3
  // branch, so the legacy `accepted: true` return announced the acceptance,
  // cleared the basket and deleted the record. A gate applied to one of two
  // accepted returns is not a gate. (Codex P2 on PR #676, valid.)
  // ====================================================================

  describe('below level 3, with a level-2 closure beside an acceptance', () => {
    /** An initiate that promises closures and NOT the correlated projection. */
    const legacyInitiated = () =>
      initiated({ checkout_protocol: undefined, quote_protocol: 2 });

    /** The read that server answers with: no `checkout`, no level 3. */
    const legacyRead = (over: Record<string, unknown> = {}) => ({
      status: 200,
      message: 'Successfully retrieved the order details',
      data: {
        id: 'o1', quote_ref: 'q1', actual_cost: '5000.00',
        quote_total: '5000.00', quote_complete: true, order_status: 'pending',
        quote_protocol: 2, quote_closure: null,
        accepted: true, accepted_at: '2026-09-18T09:59:00Z',
        items: [] as unknown[], quote: [] as unknown[],
        ...over,
      },
    });

    function priceAndAcceptAtLevel2(): string {
      component.initiateOrder();
      http.expectOne(`${API}/v2/orders/initiate/`).flush(legacyInitiated());
      const key = coordinator.record()!.key;
      component.confirmQuote();
      return key;
    }

    it('THE REGRESSION: accepted AND closed is refused here too', () => {
      const key = priceAndAcceptAtLevel2();
      loseTheReply();

      component.retryOrder();
      answerTheRead(legacyRead({ quote_closure: CLOSURE }));

      expect((component as any).recovered.kind).toBe('inconsistent');
      // NEITHER HALF IS ACTED ON.
      expect(basketService.clearBasket).not.toHaveBeenCalled();
      expect(coordinator.record()).not.toBeNull();
      expect(coordinator.record()!.key).toBe(key);
      http.expectNone(`${API}/v2/orders/initiate/`);
      expect(component.checkoutBlocked).toBeTrue();
      expect(component.recoveryNotice).toContain('check with staff');
    });

    it('CONTROL: the same answer WITHOUT a closure is still accepted', () => {
      // The compatibility half. A genuinely pre-level-3 server announcing an
      // acceptance must keep working exactly as it did.
      priceAndAcceptAtLevel2();
      loseTheReply();

      component.retryOrder();
      answerTheRead(legacyRead());

      expect((component as any).recovered.kind).toBe('accepted');
      expect(basketService.clearBasket).toHaveBeenCalled();
      expect(coordinator.record()).toBeNull();
    });
  });

  // ====================================================================
  // E1 — A BLOCK IS NOT A RENAMED MUTATION (Codex P2 on PR #676, valid)
  //
  // `checkoutBlocked` withholds Checkout, and the footer answers a block by
  // rendering **Retry** (`@if (orderError || checkoutBlocked)`). For a record
  // with NO issued command — the ordinary shape after a lost `retire-quote`
  // reply, where nothing was ever accepted — `retryOrder()` skips
  // `replayIssuedCommand`, classifies the record as a replayable initiation
  // and re-sends `orders/initiate/` under a key that may be bound to an order
  // the server has RETIRED. The reply carries the same unreadable closure, so
  // the diner loops: exactly what `checkoutBlocked`'s own comment says it
  // exists to prevent, reached through the other door.
  //
  // `placeOrder` carries the guard and claims to cover "every other entry — a
  // direct `retryOrder`"; it does not, because the two replay exits return
  // before reaching it.
  //
  // IT PREDATES THIS PR. `unusableClosure()` and `inconsistent` already
  // blocked at 477c6af; 6b9d994 added a third state to the same group. All
  // three are fixed together — fixing only the new one would be the same
  // one-consumer-not-the-next shape this pass is about.
  // ====================================================================

  describe('a commandless unreadable closure', () => {
    /** Price, never accept, then resume over the SAME record and let the
     *  startup read answer with a closure this build cannot act on. */
    function reachItOnResume() {
      component.initiateOrder();
      http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
      const key = coordinator.record()!.key;
      // THE PREMISE: nothing was ever accepted, so there is no command.
      expect(coordinator.record()!.command).toBeNull();

      const resumed = TestBed.createComponent(BasketBodyComponent);
      resumed.detectChanges();
      answerTheRead(readAnswer(
        key, { quote_closure: { ...CLOSURE, policy_version: 99 } }));
      resumed.detectChanges();
      return { key, ui: resumed.componentInstance, resumed };
    }

    it('THE REGRESSION: Retry does not re-initiate under the retired key',
       () => {
      const { key, ui } = reachItOnResume();
      expect((ui as any).recovered.kind).toBe('closure-unreadable');

      ui.retryOrder();

      // NO MUTATION BY ANY DOOR, and the attempt is preserved.
      http.expectNone(`${API}/v2/orders/initiate/`);
      http.expectNone(`${V1}/orders/submit/`);
      expect(coordinator.record()!.key).toBe(key);
      expect(coordinator.record()!.command).toBeNull();
    });

    it('and the footer offers no mutating control at all', () => {
      const { ui, resumed } = reachItOnResume();
      expect(ui.closureUnresolved).toBeTrue();

      const host = resumed.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="closure-unresolved-cta"]'))
        .not.toBeNull();
      const labels = Array.from(host.querySelectorAll('button'))
        .map((b) => (b.textContent || '').trim());
      expect(labels).not.toContain('Retry');
    });

    it('and the diner is still told, with the one remedy this build can name',
       () => {
      const { ui } = reachItOnResume();
      expect(ui.recoveryNotice).toContain('check with staff');
      expect(ui.updatedReviewPrompt).toBeNull();
    });

    it('CONTROL: an ordinary unresolved checkout still offers a real Retry',
       () => {
      // `unknown` is the state this must NOT catch: the server could not be
      // reached, nothing was asserted about the quote, and re-sending is
      // exactly the right offer.
      const key = priceAndAccept();
      loseTheReply();
      component.retryOrder();
      http.expectOne(
        (r) => r.url.startsWith(`${V1}/orders/journey/order-details/`)
          && r.url.includes('intent='),
      ).error(new ProgressEvent('error'), { status: 0 });
      fixture.detectChanges();

      expect((component as any).recovered.kind).toBe('unknown');
      expect(component.closureUnresolved).toBeFalse();
      expect(component.checkoutBlocked).toBeTrue();
      expect(coordinator.record()!.key).toBe(key);
    });
  });
});
