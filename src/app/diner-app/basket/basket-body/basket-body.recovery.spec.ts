/**
 * D04/D — the checkout survives the diner reloading, and two mounted baskets
 * cannot both check out.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `basket-body.component.spec.ts` constructs
 * the component and deliberately never calls `detectChanges()`, so it never
 * runs `ngOnInit` — which is exactly where a reload is noticed. These specs
 * render, and what they assert is what a diner actually experiences after an
 * interrupted checkout.
 *
 * THE THREE THINGS BEING PROVED:
 *
 *   1. A reload during a submission used to end at NOTHING. The key lived in
 *      an in-memory field on `BasketService`, so it went with the page and
 *      the next attempt minted a new one — the server's whole idempotency
 *      guarantee bypassed by the single most likely thing a person does when
 *      a checkout appears stuck.
 *   2. `BasketBodyComponent` is mounted TWICE on desktop (the routed page and
 *      the sidebar beside the router outlet), and `placingOrder` was a field
 *      on each, so both could run a checkout at once.
 *   3. An UNREACHABLE SERVER IS NOT EVIDENCE THAT NOTHING HAPPENED. That
 *      distinction is the whole of `unknown` vs `absent`, and getting it
 *      wrong is how a recovery mechanism creates the duplicate order it
 *      exists to prevent.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService,
} from '../../../_services/checkout-coordinator.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — interrupted checkout (D04/D)', () => {
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
    api.postPatch.and.returnValue(of() as any);
    api.get.and.returnValue(of({ data: null }) as any);
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      // A PROCESS-LOCAL counter, like the real one: `BasketService` is
      // `providedIn: 'root'`, so a page load reconstructs it at zero while
      // the basket CONTENTS come back from storage unchanged. A fixed
      // literal here would make the reload test below pass against the
      // very defect it exists to catch (Codex P1 on PR #663).
      revision: () => revision,
      // The REAL derivation, over this spec's basket — so the identity these
      // tests bind to is the one production computes, not a literal that
      // could drift from it.
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

  /** The state a tab is left in when a submission is interrupted. */
  function interruptMidSubmission(): string {
    const key = coordinator.intentKey(
      basketService.contentIdentity(), ':');
    coordinator.notePhase('submitting', { orderId: 'o1', quoteRef: 'q1' });
    return key;
  }

  /** A minimal but CONFIRMABLE initiate response.
   *
   *  Legacy-shaped on purpose (no `pricing_version`, no `quote_total`): this
   *  file is about recovery, not about the quote contract, and the legacy
   *  tolerance is the shape with the fewest moving parts that still reaches
   *  `confirmQuote`. A payload that cannot be READ would bail at the
   *  unreadable guard and prove nothing about the attempt record. */
  const initiated = (over: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o9', quote_ref: 'qref-9', actual_cost: 5000,
        no_items: 1, no_available_items: 1, no_unavailable_items: 0,
        no_available_extras: 0, no_unavailable_extras: 0, ...over,
      },
      unavailable_items: [] as unknown[], unavailable_extras: [] as unknown[],
    },
  });

  function notice(): string | null {
    const el = (fixture.nativeElement as HTMLElement)
      .querySelector('[data-testid="checkout-recovery"]');
    return el ? (el.textContent || '').trim() : null;
  }

  // -- the key survives the reload ---------------------------------------

  it('sends the SAME key after a reload, not a fresh one', () => {
    // THE DEFECT, end to end, IN BOTH ITS FORMS.
    //
    // First the key lived in a private field on `BasketService`, so this
    // second component — standing in for the page after a refresh — minted
    // a new one and the server had no way to recognise the retry.
    //
    // Then the key was persisted but SCOPED TO `revision()`, a counter on
    // the same root service. Storage survives a reload; the counter does
    // not. So the stored attempt read as belonging to a different basket
    // and a fresh key was minted anyway — the defect intact behind a
    // mechanism that looked like it had fixed it (Codex P1 on PR #663).
    // The counter moving here is what makes this test discriminate: with
    // the key bound to `revision()` it fails, and it is why the fake's
    // `revision` is a variable rather than a literal.
    revision = 7;                                  // the diner had edited
    const before = interruptMidSubmission();
    api.postPatch.and.returnValue(of(initiated()) as any);

    revision = 0;                                  // a fresh root service
    fixture.detectChanges();                       // the "reloaded" page
    component.initiateOrder();

    const sent = (api.postPatch.calls.mostRecent().args[1] as any)
      .client_order_id;
    expect(sent).toBe(before);
  });

  // -- what the reload found ---------------------------------------------

  it('tells the diner when the order was already accepted, and clears the basket', () => {
    interruptMidSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: true } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('accepted');
    expect(notice()).toContain('already placed');
    expect(basketService.clearBasket).toHaveBeenCalled();
    // the finished attempt is forgotten, so the next checkout starts clean
    expect(coordinator.attempt()).toBeNull();
  });

  it('SHOWS the accepted notice even though the basket is now empty', () => {
    // THE REAL-BROWSER CHECK FOUND THIS, and a unit spec is what stops it
    // coming back. The notice first lived in the checkout footer, which is
    // inside `@if (basketItems.length > 0)` — and an ACCEPTED recovery
    // clears the basket, so the one outcome a diner most needs to hear was
    // the one that hid the message: the tab reloaded, the basket silently
    // emptied, and they were told nothing.
    interruptMidSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: true } }) as any);
    basketService.clearBasket.and.callFake(() => { basket.items = []; });

    fixture.detectChanges();
    fixture.detectChanges();                       // re-render after the clear

    expect(basket.items.length).toBe(0);
    expect(notice()).toContain('already placed');
  });

  it('leaves an unaccepted draft exactly as it is, for the diner to review', () => {
    interruptMidSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: false } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('draft');
    expect(notice()).toContain('unfinished order');
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    // still recoverable — the key is not dropped for a draft
    expect(coordinator.attempt()).not.toBeNull();
  });

  it('drops the key when the server says the attempt never arrived', () => {
    interruptMidSubmission();
    api.get.and.returnValue(throwError(() => ({ status: 404 })) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('absent');
    expect(coordinator.attempt()).toBeNull();
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(notice()).toBeNull();                   // nothing happened to report
  });

  it('CHANGES NOTHING when the server could not be asked', () => {
    // The single most important case in this file. An unreachable server is
    // not evidence that nothing happened — dropping the key here is exactly
    // how the recovery mechanism would create the duplicate it exists to
    // prevent.
    const key = interruptMidSubmission();
    api.get.and.returnValue(throwError(() => ({ status: 0 })) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('unknown');
    expect(coordinator.attempt()!.key).toBe(key);
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it('asks nothing at all on an ordinary load', () => {
    fixture.detectChanges();
    expect(api.get).not.toHaveBeenCalled();
    expect(component.recovered).toBeNull();
  });

  it('does not recover from the always-mounted sidebar', () => {
    // The sidebar is mounted on every diner screen, so recovering there too
    // would issue the same read twice per load and let two instances narrate
    // one outcome.
    interruptMidSubmission();
    component.sidebar = true;

    fixture.detectChanges();

    expect(api.get).not.toHaveBeenCalled();
    expect(component.recovered).toBeNull();
  });

  it('clears a stale notice once the diner checks out again', () => {
    interruptMidSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: false } }) as any);
    fixture.detectChanges();
    expect(component.recoveryNotice).not.toBeNull();

    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();

    expect(component.recoveryNotice).toBeNull();
  });

  // -- one flight, two mounted baskets -----------------------------------

  it('refuses a second checkout while one is already running', () => {
    const other = TestBed.createComponent(BasketBodyComponent)
      .componentInstance;
    api.postPatch.and.returnValue(new Observable<never>(() => {}) as any);

    component.initiateOrder();
    expect(api.postPatch).toHaveBeenCalledTimes(1);

    other.initiateOrder();

    expect(api.postPatch).toHaveBeenCalledTimes(1);
  });

  it('shows BOTH mounted baskets that a checkout is running', () => {
    // Before the shared flight each instance had its own `placingOrder`, so
    // the sidebar kept a live button while the page was mid-checkout.
    const other = TestBed.createComponent(BasketBodyComponent)
      .componentInstance;
    api.postPatch.and.returnValue(new Observable<never>(() => {}) as any);

    component.initiateOrder();

    expect(component.placingOrder).toBeTrue();
    expect(other.placingOrder).toBeTrue();
  });

  it('frees the checkout for both once the attempt resolves', () => {
    const other = TestBed.createComponent(BasketBodyComponent)
      .componentInstance;
    api.postPatch.and.returnValue(
      throwError(() => 'no network') as any);

    component.initiateOrder();

    expect(component.placingOrder).toBeFalse();
    expect(other.placingOrder).toBeFalse();
  });

  // -- the phase is recorded as it advances ------------------------------

  it('records the reviewed order and quote, so a reload can ask about them', () => {
    api.postPatch.and.returnValue(of(initiated()) as any);

    component.initiateOrder();

    const attempt = coordinator.attempt()!;
    expect(attempt.phase).toBe('reviewing');
    expect(attempt.orderId).toBe('o9');
    expect(attempt.quoteRef).toBe('qref-9');
  });

  it('forgets the attempt only on a definitive success', () => {
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    expect(coordinator.attempt()).not.toBeNull();
    expect(component.quoteIsUnreadable)
      .withContext('the fixture must be confirmable').toBeFalse();

    // a failed submission keeps it — the outcome is unknown, which is
    // precisely when the key must survive
    api.postPatch.and.returnValue(throwError(() => 'no network') as any);
    component.confirmQuote();
    expect(coordinator.attempt()).not.toBeNull();

    api.postPatch.and.returnValue(of({}) as any);
    component.confirmQuote();
    expect(coordinator.attempt()).toBeNull();
  });
});
