/**
 * D06 — what the basket does when a saved quote can no longer be accepted.
 *
 * WHY THIS FILE RENDERS. `basket-body.component.spec.ts` constructs the
 * component and deliberately never calls `detectChanges()`, so it never runs
 * `ngOnInit` and never renders the footer — and the footer is where every
 * notice below lives. A spec that only pokes fields would pass while a diner
 * saw nothing at all, which is exactly the defect the D04/D recovery notice
 * shipped with.
 *
 * THE DISTINCTION UNDER TEST is TRANSIENT vs TERMINAL, and it is not a nicety:
 *
 *   - a pause or an out-of-service table leaves the quote ALIVE. Re-pricing
 *     there would throw away a perfectly good quote and ask the diner to agree
 *     to the same amount again, and it would do so while the restaurant is
 *     closed — so the reviewed quote is kept and the server's own sentence is
 *     shown with a Retry.
 *   - an expired quote or a changed purchase is RECORDED as finished by the
 *     server. Offering Retry there is a dead end: the command has already been
 *     refused and can never be accepted, so the only correct move is a fresh
 *     quote over the unchanged basket.
 *
 * Both mounts of this component run the same code, which is the point of the
 * transition living in the coordinator rather than in a branch here.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService,
  PURCHASE_CANON,
} from '../../../_services/checkout-coordinator.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — the quote lifetime (D06)', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let revision: number;
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const line = () => ({
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity: 1, selectedModifiers: [], extras: [], isDiscounted: false,
  } as unknown as BasketItem);

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    revision = 3;
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.get.and.returnValue(of({ data: null }) as any);
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => revision,
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

  /** The state a tab is in with an acceptance already issued. */
  function withIssuedCommand(): void {
    const reservation = coordinator.reserveIntent(
      { identity: basketService.contentIdentity(), canon: PURCHASE_CANON }, ':');
    expect(reservation.kind).toBe('ready');
    coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
  }

  const refusal = (reason: string, over: Record<string, unknown> = {}) => ({
    status: 400, message: `refused: ${reason}`, reason, ...over,
  });

  function footer(): string {
    fixture.detectChanges();
    return ((fixture.nativeElement as HTMLElement).textContent || '').trim();
  }

  // ---------------------------------------------------------------------
  // The coordinator's shared transition — the state move both mounts make
  // ---------------------------------------------------------------------

  describe('the shared transition', () => {
    it('leaves a live command alone for a TRANSIENT refusal', () => {
      // The restaurant paused. The quote is untouched and so is the command:
      // settling it here would let the diner start a second checkout for a
      // purchase the server has not refused.
      withIssuedCommand();
      const applied = coordinator.applyQuoteRefusal(refusal('restaurant_paused'));
      expect(applied!.disposition).toBe('transient');
      expect(coordinator.record()!.stage).toBe('accepting');
      expect(coordinator.record()!.command).not.toBeNull();
    });

    it('settles the command for a TERMINAL refusal, and KEEPS the key', () => {
      withIssuedCommand();
      const key = coordinator.record()!.key;

      const applied = coordinator.applyQuoteRefusal(refusal('quote_expired'));

      expect(applied!.disposition).toBe('terminal');
      expect(coordinator.record()!.stage).toBe('refused');
      expect(coordinator.record()!.command).toBeNull();
      // The basket is unchanged, so this is still the same purchase: a fresh
      // key would turn one attempt into two orders.
      expect(coordinator.record()!.key).toBe(key);
    });

    it('settles a REPRICE refusal the same way', () => {
      withIssuedCommand();
      expect(coordinator.applyQuoteRefusal(refusal('quote_ref_stale'))!
        .disposition).toBe('reprice');
      expect(coordinator.record()!.stage).toBe('refused');
    });

    it('settles nothing for an UNRECOGNISED reason', () => {
      withIssuedCommand();
      expect(coordinator.applyQuoteRefusal(refusal('from_the_future'))!
        .disposition).toBe('unknown');
      expect(coordinator.record()!.command).not.toBeNull();
    });

    it('is null when the failure carries no reason to act on', () => {
      withIssuedCommand();
      expect(coordinator.applyQuoteRefusal('no network')).toBeNull();
      expect(coordinator.record()!.command).not.toBeNull();
    });

    it('reports UNKNOWN when the settle cannot be written down', () => {
      // A durable write that cannot be verified must not license a re-price:
      // the record would still name an unsettled command nobody resolves.
      withIssuedCommand();
      spyOn(coordinator, 'settleRefusedCommand').and.returnValue(false);
      expect(coordinator.applyQuoteRefusal(refusal('quote_expired'))!
        .disposition).toBe('unknown');
    });
  });

  // ---------------------------------------------------------------------
  // What the diner is told
  // ---------------------------------------------------------------------

  describe('what the diner is told', () => {
    it('keeps the reviewed quote and offers Retry on a transient refusal', () => {
      (component as any).reviewedQuote = { ref: 'q1', revision, context: ':' };
      (component as any).submitOrder = () => {};
      withIssuedCommand();

      (component as any).handleSubmitFailure(
        refusal('restaurant_paused'));

      expect(component.quoteRetired).toBeFalse();
      expect(component.orderError).toBeTrue();
      // The QUOTE survives — the diner is not sent back to re-agree to the
      // same amount because the kitchen is closed for ten minutes.
      expect((component as any).reviewedQuote).not.toBeNull();
    });

    it('re-prices and says so on a terminal refusal', () => {
      const placed = spyOn(component as any, 'placeOrder').and.stub();
      withIssuedCommand();

      (component as any).handleSubmitFailure(refusal('quote_expired'));

      expect(component.quoteRetired).toBeTrue();
      expect((component as any).reviewedQuote).toBeNull();
      expect(placed).toHaveBeenCalled();
      expect(footer()).toContain("checking today's prices");
    });

    it('re-prices WITHOUT the retired claim on a reprice refusal', () => {
      // `quote_ref_stale` retires nothing. Telling the diner their order "can
      // no longer be placed" would be a claim nobody made.
      const placed = spyOn(component as any, 'placeOrder').and.stub();
      withIssuedCommand();

      (component as any).handleSubmitFailure(refusal('quote_ref_stale'));

      expect(component.quoteRetired).toBeFalse();
      expect(placed).toHaveBeenCalled();
      expect(footer()).not.toContain("checking today's prices");
    });

    it('sends nothing and re-prices nothing on an unknown refusal', () => {
      const placed = spyOn(component as any, 'placeOrder').and.stub();
      withIssuedCommand();

      (component as any).handleSubmitFailure(refusal('from_the_future'));

      expect(placed).not.toHaveBeenCalled();
      expect(component.orderError).toBeTrue();
    });

    it('clears the retired notice when the diner presses Checkout again', () => {
      component.quoteRetired = true;
      spyOn(component as any, 'placeOrder').and.stub();

      component.initiateOrder();

      expect(component.quoteRetired).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------
  // The renewal path — asking the server rather than deciding
  // ---------------------------------------------------------------------

  describe('renewing a quote whose deadline has passed here', () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    /**
     * A REVIEW SHEET THE COMPONENT WILL ACTUALLY CONFIRM.
     *
     * Legacy-shaped (no `pricing_version`, no `quote_total`) on purpose: this
     * group is about the deadline, not the quote contract, and the legacy
     * tolerance is the readable shape with the fewest moving parts. A payload
     * the component cannot READ bails at the unreadable guard long before the
     * deadline is consulted, and every assertion here would then be measuring
     * that guard instead.
     */
    function reviewing(expiresAt: string | null, level = 1): void {
      (component as any).order_initiated = {
        order_details: {
          id: 'o9', actual_cost: 5000,
          no_items: 1, no_available_items: 1, no_unavailable_items: 0,
          no_available_extras: 0, no_unavailable_extras: 0,
          quote_protocol: level,
          quote_policy: expiresAt === null
            ? null
            : { version: 1, status: 'live', expires_at: expiresAt },
        },
        unavailable_items: [] as unknown[],
        unavailable_extras: [] as unknown[],
      };
      (component as any).reviewedQuote = {
        ref: 'q1',
        revision: basketService.revision(),
        context: (component as any).checkoutContext(),
      };
      (component as any).showQuoteSheet = true;
    }

    it('asks the server instead of deciding for itself', () => {
      reviewing(past);
      const submitted = spyOn(component as any, 'submitOrder').and.stub();
      api.postPatch.and.returnValue(
        of({ status: 200, outcome: 'quote_still_valid' }) as any);

      component.confirmQuote();

      expect(api.postPatch.calls.mostRecent().args[0])
        .toBe('orders/retire-quote/');
      // The clock here was ahead. The server says the quote stands, so the
      // diner's confirmation proceeds exactly as they asked.
      expect(submitted).toHaveBeenCalled();
    });

    it('re-prices when the server retires it', () => {
      reviewing(past);
      const placed = spyOn(component as any, 'placeOrder').and.stub();
      api.postPatch.and.returnValue(of({
        status: 200, outcome: 'quote_closed', reason: 'quote_expired',
      }) as any);

      component.confirmQuote();

      expect(component.quoteRetired).toBeTrue();
      expect(placed).toHaveBeenCalled();
    });

    it('submits nothing when the enquiry fails', () => {
      // A round trip that did not answer is not an answer, and must never be
      // turned into permission to submit.
      reviewing(past);
      const submitted = spyOn(component as any, 'submitOrder').and.stub();
      api.postPatch.and.returnValue(throwError(() => 'no network') as any);

      component.confirmQuote();

      expect(submitted).not.toHaveBeenCalled();
      expect(component.orderError).toBeTrue();
    });

    it('does NOT ask while the deadline has not passed', () => {
      reviewing(new Date(Date.now() + 600_000).toISOString());
      const submitted = spyOn(component as any, 'submitOrder').and.stub();

      component.confirmQuote();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(submitted).toHaveBeenCalled();
    });

    it('does NOT ask an older server that never published a deadline', () => {
      // Absence is not evidence. A server at level 0 has said nothing about
      // quote lifetime, and inventing one here would refuse its checkouts.
      reviewing(past, 0);
      const submitted = spyOn(component as any, 'submitOrder').and.stub();

      component.confirmQuote();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(submitted).toHaveBeenCalled();
    });
  });
});
