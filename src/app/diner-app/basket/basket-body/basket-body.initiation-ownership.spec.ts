/**
 * I1 — A LATE INITIATION ANSWER MUST NOT UNDO A NEWER ACCEPTANCE STATE.
 *
 * THE SCHEDULE, and why every step of it is forced:
 *
 *   1. routed instance A prices the basket — K1 reserved, `orders/initiate/`
 *      sent, the reply HELD after the server created O1/Q1.
 *   2. the diner navigates away. A is destroyed: it correctly gives the
 *      app-wide flight back, and Angular does NOT cancel its request, so the
 *      reply is still coming.
 *   3. a second real instance B reserves the SAME key for the SAME purchase
 *      (that is what `reserveIntent` is for), prices, reviews and ISSUES the
 *      acceptance — so the durable record is K1 / `accepting` / {O1,Q1}.
 *   4. B's submit reply is lost. The record is now the only thing that can
 *      resolve the outstanding command.
 *   5. A's older initiation reply is released, with the cart contents, the
 *      basket revision and the restaurant/table all UNCHANGED — so every
 *      guard the component already had (`isCurrent`'s revision and context
 *      comparison) passes.
 *
 * On the reviewed revision A's callback then writes `noteStage('reviewing')`
 * over the shared record. The issued command is still on the object, but
 * `isOutstanding` reads the STAGE — so a later changed purchase is no longer
 * refused and `reserveIntent` mints a fresh key, erasing the only handle the
 * outstanding acceptance could ever be recovered by.
 *
 * WHAT THESE SPECS DRIVE. Two real `BasketBodyComponent` instances over ONE
 * real coordinator and real session storage, the real `ApiService`, the real
 * `HttpClient` and the real `ErrorInterceptor`. A spy coordinator cannot show
 * this: the defect is the interaction between one component's held callback
 * and another component's durable write.
 *
 * THE CONTROLS MATTER AS MUCH AS THE REGRESSIONS. A changed basket revision
 * was ALREADY refused before this change, so a spec that edits the cart proves
 * nothing about the new guard — every schedule below therefore holds the cart,
 * the revision and the scope identical and lets the state be the only
 * discriminator. And an ordinary timely initiation, and a lost-successor
 * replay under the original key, must both go on working.
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
import {
  CheckoutCoordinatorService,
} from '../../../_services/checkout-coordinator.service';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { DinerSessionService } from '../../../_services/diner-session.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — initiation-answer ownership (D06/I1)', () => {
  let http: HttpTestingController;
  let basket: { items: BasketItem[]; totalAmount: number };
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let dinerSession: DinerSessionService;

  const API = `${environment.apiUrl}/api`;
  const V1 = `${API}/${environment.version}`;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  /** A complete, otherwise-valid initiate 200 — so a refusal below is the
   *  new guard and never an unrelated structural rejection of the quote. */
  const initiated = (
    orderId = 'o1', quoteRef = 'q1', details: Record<string, unknown> = {},
  ) => ({
    status: 200,
    data: {
      order_details: {
        id: orderId, quote_ref: quoteRef, actual_cost: '5000.00',
        quote_total: '5000.00', pricing_version: 'CORRECTED',
        checkout_protocol: 3, quote_protocol: 2,
        ...details,
      },
      order_items: [], available_items: [], unavailable_items: [],
      extras: [], available_extras: [], unavailable_extras: [],
      quote: [], quote_total: '5000.00',
    },
  });

  /** A correlated acceptance (checkout_protocol 3), so `submitVerdict`
   *  resolves `accepted` rather than refusing an unreadable projection. */
  const accepted = (key: string) => ({
    status: 200, message: 'Order placed.', idempotent: false,
    checkout: {
      order_id: 'o1', intent_key: key,
      scope: { restaurant: 'r1', table: 't1' },
      acceptance: { state: 'accepted', outcome: 'newly_accepted',
                    quote_ref: 'q1', accepted_at: '2026-09-18T10:00:00Z' },
      current: { order_status: 'pending', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null },
      checkout_protocol: 3,
    },
  });

  const CLOSURE = {
    closed_at: '2026-09-18T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
  };

  function makeComponent(): ComponentFixture<BasketBodyComponent> {
    const fixture = TestBed.createComponent(BasketBodyComponent);
    // Every schedule drives its own requests, so a routed instance's resume
    // must not consume one first.
    fixture.componentInstance.sidebar = true;
    return fixture;
  }

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
    dinerSession = TestBed.inject(DinerSessionService);
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

  /** Step 1-2: A prices, is destroyed, and its reply is still coming. */
  function priceAndAbandon() {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    const held = http.expectOne(`${API}/v2/orders/initiate/`);
    const key = coordinator.record()!.key;
    fixture.destroy();
    return { held, key };
  }

  /** Step 3-4: B reserves the SAME key, prices, accepts, loses the reply. */
  function acceptOnASecondMount(key: string) {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    expect(coordinator.record()!.key)
      .withContext('B must reserve the SAME key — otherwise the schedule '
                   + 'below tests two unrelated attempts')
      .toBe(key);
    fixture.componentInstance.confirmQuote();
    http.expectOne(`${V1}/orders/submit/`)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
    return fixture;
  }

  // -- I1-a: the same-key progression ------------------------------------

  it('THE PREMISE: B holds an outstanding acceptance on the key A is still '
     + 'pricing under', () => {
    const { held, key } = priceAndAbandon();
    acceptOnASecondMount(key);

    const record = coordinator.record()!;
    expect(record.key).toBe(key);
    expect(record.stage).toBe('accepting');
    expect(record.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
    expect(coordinator.isOutstanding(record)).toBeTrue();

    held.flush(initiated());
  });

  it('THE REGRESSION: A\'s older initiation answer does not move the record '
     + 'back to `reviewing`', () => {
    const { held, key } = priceAndAbandon();
    acceptOnASecondMount(key);

    held.flush(initiated());

    const record = coordinator.record()!;
    expect(record.key).toBe(key);
    expect(record.stage).toBe('accepting');
  });

  it('THE REGRESSION: and the issued command survives, so the acceptance is '
     + 'still outstanding', () => {
    const { held, key } = priceAndAbandon();
    acceptOnASecondMount(key);

    held.flush(initiated());

    const record = coordinator.record()!;
    expect(record.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
    expect(coordinator.isOutstanding(record)).toBeTrue();
  });

  it('THE CONSEQUENCE: a changed purchase afterwards cannot replace the '
     + 'unresolved acceptance with a fresh key', () => {
    const { held, key } = priceAndAbandon();
    acceptOnASecondMount(key);

    held.flush(initiated());

    // The diner edits the basket and presses Checkout on a live mount. The
    // record of an acceptance whose outcome is unknown is the ONLY thing that
    // can resolve it, so the reservation must refuse rather than mint.
    const reserved = coordinator.reserveIntent(
      { identity: 'a-different-basket',
        canon: coordinator.record()!.request.canon,
        items: [] },
      'r1:t1',
    );
    expect(reserved.kind).toBe('outstanding');
    expect(coordinator.record()!.key).toBe(key);
    expect(coordinator.record()!.command)
      .toEqual({ orderId: 'o1', quoteRef: 'q1' });
  });

  // -- I1-b: the successor (K1 -> K2) progression ------------------------

  it('THE REGRESSION: A\'s old answer for K1 does not bind its quote to the '
     + 'successor K2, nor move K2\'s stage', () => {
    const { held, key: k1 } = priceAndAbandon();

    // A closure is established for K1 and the diner deliberately takes the
    // review, which mints K2 for the SAME purchase.
    const b = makeComponent();
    b.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`)
      .flush(initiated('o1', 'q1', { quote_closure: CLOSURE }));
    expect(coordinator.record()!.key).toBe(k1);
    expect(coordinator.currentClosure()!.evidence.kind).toBe('closure');

    b.componentInstance.reviewUpdatedOrder();
    const k2 = coordinator.record()!.key;
    expect(k2).not.toBe(k1);
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated('o2', 'q2'));
    expect(coordinator.record()!.stage).toBe('reviewing');

    b.componentInstance.confirmQuote();
    http.expectOne(`${V1}/orders/submit/`)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown' });
    expect(coordinator.record()!.stage).toBe('accepting');

    // A's ORIGINAL K1 answer finally lands.
    held.flush(initiated('o1', 'q1'));

    const record = coordinator.record()!;
    expect(record.key).toBe(k2);
    expect(record.stage).toBe('accepting');
    expect(record.command).toEqual({ orderId: 'o2', quoteRef: 'q2' });
    expect(record.replaces).toBe(k1);
  });

  it('THE REGRESSION: a destroyed instance does not publish a review, so its '
     + 'answer cannot be submitted by anything', () => {
    const { held, key } = priceAndAbandon();
    acceptOnASecondMount(key);

    held.flush(initiated());

    // Nothing may be sent off the back of an answer for an instance that is
    // gone; the acceptance stays the only outstanding operation.
    http.expectNone(`${V1}/orders/submit/`);
  });

  // -- the per-instance half, on its own --------------------------------

  /**
   * THE NEAR GUARD, ISOLATED. The two protections are layered and the
   * schedules above exercise both at once, because the only way a second mount
   * can price at all is for the first to give the app-wide flight back — which
   * today means being destroyed. So these two cases hold the RECORD still and
   * let the destruction be the only discriminator: nothing else has happened,
   * the attempt is still perfectly current, and the answer belongs to a
   * component the diner has navigated away from.
   */
  it('a destroyed instance renders nothing for its own late answer, and '
     + 'assigns no quote from it', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    const held = http.expectOne(`${API}/v2/orders/initiate/`);
    const component = fixture.componentInstance;
    fixture.destroy();

    held.flush(initiated());

    expect(component.showQuoteSheet).toBeFalse();
    expect((component as any).order_initiated).toBeUndefined();
    expect((component as any).reviewedQuote).toBeNull();
  });

  it('THE REGRESSION: an old answer\'s CLOSURE does not retire the successor '
     + 'it is not about', () => {
    const { held, key: k1 } = priceAndAbandon();

    // K1's quote is retired and the diner takes the review, which mints K2.
    const b = makeComponent();
    b.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`)
      .flush(initiated('o1', 'q1', { quote_closure: CLOSURE }));
    b.componentInstance.reviewUpdatedOrder();
    const k2 = coordinator.record()!.key;
    expect(k2).not.toBe(k1);
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated('o2', 'q2'));
    expect(coordinator.currentClosure()!.evidence.kind).toBe('absent');

    // A's ORIGINAL K1 answer lands, carrying K1's closure. Consuming it would
    // write Q1's retirement onto a brand-new attempt that has never been
    // refused — the successor retired on the strength of evidence about its
    // predecessor.
    held.flush(initiated('o1', 'q1', { quote_closure: CLOSURE }));

    const record = coordinator.record()!;
    expect(record.key).toBe(k2);
    expect(record.stage).toBe('reviewing');
    expect(coordinator.currentClosure()!.evidence.kind).toBe('absent');
    expect(b.componentInstance.updatedReviewPrompt).toBeNull();
  });

  it('THE REGRESSION: nor does it note K1\'s demonstrated level on K2', () => {
    const { held, key: k1 } = priceAndAbandon();

    const b = makeComponent();
    b.componentInstance.initiateOrder();
    // A LEVEL-0 SERVER for the successor: it states neither protocol, so any
    // level on K2 afterwards can only have come from A's K1 answer.
    http.expectOne(`${API}/v2/orders/initiate/`)
      .flush(initiated('o1', 'q1', { quote_closure: CLOSURE }));
    b.componentInstance.reviewUpdatedOrder();
    const k2 = coordinator.record()!.key;
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated(
      'o2', 'q2', { checkout_protocol: undefined,
                    quote_protocol: undefined }));
    expect(coordinator.record()!.protocol).toBe(0);
    expect(coordinator.record()!.quoteProtocol).toBe(0);

    held.flush(initiated('o1', 'q1'));

    expect(coordinator.record()!.key).toBe(k2);
    expect(coordinator.record()!.protocol).toBe(0);
    expect(coordinator.record()!.quoteProtocol).toBe(0);
  });

  // -- I1-c: the direct-submit consumers ---------------------------------

  it('A late submit ERROR from a destroyed instance does not invalidate a '
     + 'freshly scanned diner session', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    fixture.componentInstance.confirmQuote();
    const submit = http.expectOne(`${V1}/orders/submit/`);
    fixture.destroy();

    const invalidate = spyOn(dinerSession, 'invalidateCredential');
    // The capability channel's own non-disclosing refusal, byte for byte
    // (backend A1b) — the answer a REVOKED session gets.
    submit.flush(
      { status: 404, message: 'Not found.' },
      { status: 404, statusText: 'Not Found' });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('A late submit ERROR from a destroyed instance does not expire a live '
     + 'diner session', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    fixture.componentInstance.confirmQuote();
    const submit = http.expectOne(`${V1}/orders/submit/`);
    fixture.destroy();

    const expire = spyOn(dinerSession, 'expireSession');
    submit.flush(
      { status: 400, message: 'Your table session has expired.' },
      { status: 400, statusText: 'Bad Request' });

    expect(expire).not.toHaveBeenCalled();
  });

  it('A late submit ERROR from a destroyed instance interprets nothing — no '
     + 'legacy verdict and no re-price', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    const component = fixture.componentInstance;
    component.confirmQuote();
    const submit = http.expectOne(`${V1}/orders/submit/`);
    fixture.destroy();

    submit.flush(
      { status: 400, message: 'Re-price required.',
        reason: 'legacy_pricing_version' },
      { status: 400, statusText: 'Bad Request' });

    expect(component.legacyDraft).toBeFalse();
    // And nothing was re-priced on its behalf.
    http.expectNone(`${API}/v2/orders/initiate/`);
  });

  it('CONTROL: a LIVE instance still reads a credential denial and a legacy '
     + 'refusal from its own submit', () => {
    const denied = makeComponent();
    denied.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    denied.componentInstance.confirmQuote();
    const invalidate = spyOn(dinerSession, 'invalidateCredential');
    http.expectOne(`${V1}/orders/submit/`).flush(
      { status: 404, message: 'Not found.' },
      { status: 404, statusText: 'Not Found' });
    expect(invalidate).toHaveBeenCalled();

    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    basket.items = [line(), line()];
    const legacy = makeComponent();
    legacy.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    legacy.componentInstance.confirmQuote();
    http.expectOne(`${V1}/orders/submit/`).flush(
      { status: 400, message: 'Re-price required.',
        reason: 'legacy_pricing_version' },
      { status: 400, statusText: 'Bad Request' });
    expect(legacy.componentInstance.legacyDraft).toBeTrue();
  });

  it('A late submit SUCCESS from a destroyed instance navigates nothing and '
     + 'forgets nothing', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    const key = coordinator.record()!.key;
    fixture.componentInstance.confirmQuote();
    const submit = http.expectOne(`${V1}/orders/submit/`);
    fixture.destroy();

    const navigate = TestBed.inject(Router).navigate as jasmine.Spy;
    navigate.calls.reset();
    submit.flush(accepted(key));

    // The diner has left this screen; nothing may drag them to a confirmation
    // page for it.
    expect(navigate).not.toHaveBeenCalled();
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    // AND THE EVIDENCE IS NOT THROWN AWAY. The record survives with its
    // command intact, so the next load resolves the acceptance through the
    // ordinary authorized read and announces it there.
    const record = coordinator.record()!;
    expect(record.key).toBe(key);
    expect(record.command).toEqual({ orderId: 'o1', quoteRef: 'q1' });
  });

  it('CONTROL: a LIVE instance\'s submit success still completes the '
     + 'checkout', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    const key = coordinator.record()!.key;
    fixture.componentInstance.confirmQuote();

    const navigate = TestBed.inject(Router).navigate as jasmine.Spy;
    navigate.calls.reset();
    http.expectOne(`${V1}/orders/submit/`).flush(accepted(key));

    expect(navigate).toHaveBeenCalled();
    expect(basketService.clearBasket).toHaveBeenCalled();
    expect(coordinator.record()).toBeNull();
  });

  // -- the controls that must not change ---------------------------------

  it('CONTROL: an ordinary timely initiation still reviews', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());

    expect(fixture.componentInstance.showQuoteSheet).toBeTrue();
    expect(coordinator.record()!.stage).toBe('reviewing');
  });

  it('CONTROL: a lost-successor retry still replays under the original key '
     + 'and reviews', () => {
    const fixture = makeComponent();
    fixture.componentInstance.initiateOrder();
    const first = http.expectOne(`${API}/v2/orders/initiate/`);
    const key = coordinator.record()!.key;
    // The initiation itself is lost.
    first.error(new ProgressEvent('error'),
                { status: 0, statusText: 'Unknown' });
    expect(coordinator.record()!.key).toBe(key);

    fixture.componentInstance.retryOrder();
    const replay = http.expectOne(`${API}/v2/orders/initiate/`);
    expect((replay.request.body as any).client_order_id).toBe(key);
    replay.flush(initiated());

    expect(fixture.componentInstance.showQuoteSheet).toBeTrue();
    expect(coordinator.record()!.key).toBe(key);
    expect(coordinator.record()!.stage).toBe('reviewing');
  });
});
