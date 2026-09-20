/**
 * I2 — BOTH INITIATION DOORS MUST READ THE CLOSURE, AND A FAILED WRITE IS NOT
 * A REVIEW.
 *
 * TWO DEFECTS, ONE HANDLER BETWEEN THEM.
 *
 * A. `replayInitiation` — the Retry door — assigned the response, noted the
 *    protocols, wrote the reviewed quote and opened the sheet, and never asked
 *    whether the order it got back still had a quote that could be accepted.
 *    A replay legitimately returns an order whose quote was retired AFTER the
 *    original initiation (a refusal whose reply was lost, the other mount, or
 *    `retire-quote`), so a healthy envelope carrying a CLOSED quote was
 *    presented as an ordinary confirmable review purely because it arrived
 *    through Retry.
 *
 * B. `placeOrder` — the Checkout door — DID consume the closure, but only when
 *    the write succeeded: `if (establishClosure(...)) { ...return }` FELL
 *    THROUGH on a failed write to `noteStage('reviewing')` and the ordinary
 *    sheet. So a device whose storage refuses writes was shown a confirmable
 *    review for a quote the same response had just said was permanently
 *    closed, with the record left saying nothing about it.
 *
 * C. And an unusable closure on that door called `failOrder` alone — an inline
 *    message on ONE instance. `checkoutBlocked` and `closureUnresolved` cannot
 *    read a message, so the footer went on offering a mutating Retry through
 *    the weaker replay path.
 *
 * WHAT THESE SPECS DRIVE. The real component, the real coordinator over real
 * session storage, the real `ApiService`/`HttpClient`/`ErrorInterceptor`. The
 * quote fixtures are COMPLETE and otherwise valid, so a refusal below is the
 * closure decision and never an unrelated structural rejection.
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
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — closure at both initiation doors (D06/I2)',
() => {
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

  const CLOSURE = {
    closed_at: '2026-09-18T10:00:00Z',
    reason: 'quote_expired',
    quote_ref: 'q1',
    policy_version: 1,
  };

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
    window.sessionStorage.setItem(
      'Table', JSON.stringify({ value: { id: 't1' } }));
    window.sessionStorage.setItem(
      'restaurant', JSON.stringify({ value: { id: 'r1' } }));
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
    component.sidebar = true;
  });

  afterEach(() => {
    http.verify();
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
    window.sessionStorage.removeItem('Table');
    window.sessionStorage.removeItem('restaurant');
  });

  /**
   * Reach the Retry door with a reserved key and NOTHING issued against it —
   * the ordinary shape after an initiation whose reply was lost. `retryOrder`
   * then classifies the record as a replayable initiation and re-sends the
   * stored request under the stored key.
   */
  function reachTheReplayDoor(): string {
    component.initiateOrder();
    http.expectOne(`${API}/v2/orders/initiate/`)
      .error(new ProgressEvent('error'),
             { status: 0, statusText: 'Unknown' });
    const key = coordinator.record()!.key;
    expect(coordinator.record()!.command).toBeNull();
    return key;
  }

  /** Drive Retry and answer its replay with `body`. Asserts the replay really
   *  is the original key and request. */
  function replayAnswers(key: string, body: object) {
    component.retryOrder();
    const replay = http.expectOne(`${API}/v2/orders/initiate/`);
    expect((replay.request.body as any).client_order_id).toBe(key);
    replay.flush(body);
  }

  // -- A: the replay door consumes the closure ---------------------------

  describe('a valid closure returned through Retry', () => {
    it('THE REGRESSION: does not open an ordinary confirmable review', () => {
      const key = reachTheReplayDoor();
      replayAnswers(key, initiated({ quote_closure: CLOSURE }));

      expect(component.showQuoteSheet).toBeFalse();
    });

    it('THE REGRESSION: records the closure durably, so BOTH mounts read one '
       + 'established fact', () => {
      const key = reachTheReplayDoor();
      replayAnswers(key, initiated({ quote_closure: CLOSURE }));

      const stored = coordinator.currentClosure()!;
      expect(stored.evidence.kind).toBe('closure');
      expect(stored.predecessor!.key).toBe(key);

      // The desktop sidebar never runs recovery; the record is what it reads.
      // `updatedReviewPrompt` is the gate that matters — the footer tests it
      // BEFORE `closureUnresolved`/`checkoutBlocked`, so a non-null prompt is
      // what replaces Checkout and Retry with the review action.
      const other = TestBed.createComponent(BasketBodyComponent);
      other.componentInstance.sidebar = true;
      expect(other.componentInstance.updatedReviewPrompt).not.toBeNull();

      // And that mount cannot price under the retired key either.
      other.componentInstance.initiateOrder();
      http.expectNone(`${API}/v2/orders/initiate/`);
    });

    it('THE REGRESSION: offers the explicit review as the only action, and '
       + 'sends no acceptance to discover what it already knows', () => {
      const key = reachTheReplayDoor();
      replayAnswers(key, initiated({ quote_closure: CLOSURE }));

      expect(component.updatedReviewPrompt).not.toBeNull();
      // No acceptance, and no re-price under the key the closure names: the
      // answer to both is already in hand.
      http.expectNone(`${V1}/orders/submit/`);
      component.initiateOrder();
      http.expectNone(`${API}/v2/orders/initiate/`);
    });

    it('and the successor is minted only when the diner takes it', () => {
      const key = reachTheReplayDoor();
      replayAnswers(key, initiated({ quote_closure: CLOSURE }));
      expect(coordinator.record()!.key).toBe(key);

      component.reviewUpdatedOrder();
      const successor = coordinator.record()!;
      expect(successor.key).not.toBe(key);
      expect(successor.replaces).toBe(key);
      http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
    });
  });

  describe('a closure through Retry that this build may not act on', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['malformed', { quote_closure: { reason: 'quote_expired' } }],
      ['an unsupported policy version',
       { quote_closure: { ...CLOSURE, policy_version: 99 } }],
      ['a reason outside the vocabulary',
       { quote_closure: { ...CLOSURE, reason: 'restaurant_paused' } }],
    ];

    cases.forEach(([name, details]) => {
      it(`THE REGRESSION: ${name} does not become an ordinary review`, () => {
        const key = reachTheReplayDoor();
        replayAnswers(key, initiated(details));

        expect(component.showQuoteSheet).toBeFalse();
        expect(component.closureUnresolved).toBeTrue();
        expect(component.checkoutBlocked).toBeTrue();
      });
    });

    it('THE REGRESSION: a server that demonstrated the level and then omits '
       + 'it is broken, not older', () => {
      // The level this server already demonstrated for THIS attempt is
      // remembered (G4), so silence afterwards is a broken promise rather
      // than an older backend.
      component.initiateOrder();
      http.expectOne(`${API}/v2/orders/initiate/`).flush(initiated());
      expect(coordinator.record()!.quoteProtocol).toBe(2);
      const key = coordinator.record()!.key;

      component.showQuoteSheet = false;
      component.retryOrder();
      const replay = http.expectOne(`${API}/v2/orders/initiate/`);
      expect((replay.request.body as any).client_order_id).toBe(key);
      replay.flush(initiated({ quote_protocol: undefined }));

      expect(component.showQuoteSheet).toBeFalse();
      expect(component.closureUnresolved).toBeTrue();
    });

    it('CONTROL: a genuinely older server, which never promised to publish a '
       + 'closure, still reviews', () => {
      const key = reachTheReplayDoor();
      replayAnswers(key, initiated({ quote_protocol: 1 }));

      expect(component.showQuoteSheet).toBeTrue();
      expect(component.closureUnresolved).toBeFalse();
    });

    it('CONTROL: an ordinary open quote through Retry still reviews', () => {
      const key = reachTheReplayDoor();
      replayAnswers(key, initiated());

      expect(component.showQuoteSheet).toBeTrue();
      expect(component.closureUnresolved).toBeFalse();
      expect(coordinator.record()!.key).toBe(key);
      expect(coordinator.record()!.stage).toBe('reviewing');
    });
  });

  // -- B: a closure that cannot be written down --------------------------

  describe('a valid closure whose local write fails', () => {
    /** A store that ACCEPTS the write, throws nothing and keeps the previous
     *  value — the realistic failure `persist`'s read-back exists for. */
    const silentlyDrops = () =>
      spyOn(window.sessionStorage, 'setItem').and.stub();
    /** And the noisier one. */
    const throws = () => spyOn(window.sessionStorage, 'setItem')
      .and.throwError('QuotaExceededError');

    [['a read-back that disagrees', silentlyDrops],
     ['a setItem that throws', throws],
    ].forEach(([name, breakIt]) => {
      it(`THE REGRESSION: ${name} does not fall through to the ordinary `
         + 'review sheet', () => {
        component.initiateOrder();
        const req = http.expectOne(`${API}/v2/orders/initiate/`);
        (breakIt as () => void)();
        req.flush(initiated({ quote_closure: CLOSURE }));

        expect(component.showQuoteSheet).toBeFalse();
        expect(component.checkoutBlocked).toBeTrue();
        expect(component.closureUnresolved).toBeTrue();
      });

      it(`THE REGRESSION: ${name} mints no successor and keeps the key`,
         () => {
        component.initiateOrder();
        const req = http.expectOne(`${API}/v2/orders/initiate/`);
        const key = coordinator.record()!.key;
        (breakIt as () => void)();
        req.flush(initiated({ quote_closure: CLOSURE }));

        expect(coordinator.record()!.key).toBe(key);
        // No closure was written, so there is nothing to mint a successor
        // FROM — and nothing may be invented.
        expect(coordinator.renewAfterClosure().kind).toBe('none');
      });

      it(`${name} gives the checkout flight back`, () => {
        component.initiateOrder();
        const req = http.expectOne(`${API}/v2/orders/initiate/`);
        (breakIt as () => void)();
        req.flush(initiated({ quote_closure: CLOSURE }));

        expect(component.placingOrder).toBeFalse();
      });

      it(`${name} says what is known and what is not, without claiming the `
         + 'server failed to close the quote', () => {
        component.initiateOrder();
        const req = http.expectOne(`${API}/v2/orders/initiate/`);
        (breakIt as () => void)();
        req.flush(initiated({ quote_closure: CLOSURE }));

        const notice = (component.recoveryNotice ?? '').toLowerCase();
        expect(notice).not.toBe('');
        expect(notice).toContain('reload');
      });
    });

    it('THE REGRESSION: and the same is true at the Retry door', () => {
      const key = reachTheReplayDoor();
      component.retryOrder();
      const replay = http.expectOne(`${API}/v2/orders/initiate/`);
      expect((replay.request.body as any).client_order_id).toBe(key);
      spyOn(window.sessionStorage, 'setItem').and.stub();
      replay.flush(initiated({ quote_closure: CLOSURE }));

      expect(component.showQuoteSheet).toBeFalse();
      expect(component.closureUnresolved).toBeTrue();
    });

    it('a later successful read resolves it — the write is retried, not '
       + 'guessed', () => {
      component.initiateOrder();
      const req = http.expectOne(`${API}/v2/orders/initiate/`);
      const key = coordinator.record()!.key;
      const broken = spyOn(window.sessionStorage, 'setItem').and.stub();
      req.flush(initiated({ quote_closure: CLOSURE }));
      expect(coordinator.currentClosure()!.evidence.kind).toBe('absent');

      // Storage recovers (a fresh document, a freed quota). A reload's
      // recovery read finds the SAME published closure and writes it then.
      broken.and.callThrough();
      const resumed = TestBed.createComponent(BasketBodyComponent);
      resumed.componentInstance.sidebar = false;
      resumed.detectChanges();
      http.expectOne(
        (r) => r.url.startsWith(`${V1}/orders/journey/order-details/`)
          && r.url.includes('intent=')).flush({
        status: 200, message: 'ok',
        data: {
          id: 'o1', quote_ref: 'q1', actual_cost: '5000.00',
          quote_total: '5000.00', quote_complete: true,
          order_status: 'initiated', checkout_protocol: 3, quote_protocol: 2,
          quote_closure: CLOSURE, accepted: false, accepted_at: null,
          checkout: {
            order_id: 'o1', intent_key: key,
            scope: { restaurant: 'r1', table: 't1' },
            acceptance: { state: 'not_accepted', outcome: null,
                          quote_ref: null, accepted_at: null },
            current: { order_status: 'initiated', fulfilment_status: 'new',
                       cancelled_at: null, served_at: null },
            checkout_protocol: 3,
          },
          items: [] as unknown[], quote: [] as unknown[],
        },
      });

      expect(coordinator.currentClosure()!.evidence.kind).toBe('closure');
      expect(resumed.componentInstance.updatedReviewPrompt).not.toBeNull();
    });
  });

  // -- C: unusable evidence survives the handler -------------------------

  describe('an unusable closure at the Checkout door', () => {
    it('THE REGRESSION: is shared state, not only an inline message', () => {
      component.initiateOrder();
      http.expectOne(`${API}/v2/orders/initiate/`)
        .flush(initiated({ quote_closure: { ...CLOSURE, policy_version: 99 } }));

      // `checkoutBlocked` and `closureUnresolved` cannot read `orderError`.
      expect(component.closureUnresolved).toBeTrue();
      expect(component.checkoutBlocked).toBeTrue();
      expect(component.showQuoteSheet).toBeFalse();
    });

    it('THE REGRESSION: so the weaker replay path cannot offer a mutating '
       + 'Retry around it', () => {
      component.initiateOrder();
      http.expectOne(`${API}/v2/orders/initiate/`)
        .flush(initiated({ quote_closure: { ...CLOSURE, policy_version: 99 } }));

      component.retryOrder();
      http.expectNone(`${API}/v2/orders/initiate/`);
      http.expectNone(`${V1}/orders/submit/`);
    });
  });
});
