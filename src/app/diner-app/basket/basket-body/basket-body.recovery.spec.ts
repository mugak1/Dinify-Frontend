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
  PURCHASE_CANON,
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
    const reservation = coordinator.reserveIntent(
      { identity: basketService.contentIdentity(), canon: PURCHASE_CANON },
      ':');
    expect(reservation.kind).toBe('ready');
    coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
    return reservation.kind === 'ready' ? reservation.key : '';
  }

  /**
   * The state a tab is left in BEFORE the acceptance is issued — the diner
   * was reading the quote, or the initiate response was lost.
   *
   * Kept apart from `interruptMidSubmission` because the two are genuinely
   * different situations and the client answers them differently: with no
   * command recorded, an unaccepted order can only be the draft that
   * initiate created, so a pre-correlation server's ambiguous `false` is
   * resolvable from this client's own record. After a command it is not.
   */
  function interruptBeforeSubmission(): string {
    const reservation = coordinator.reserveIntent(
      { identity: basketService.contentIdentity(), canon: PURCHASE_CANON },
      ':');
    expect(reservation.kind).toBe('ready');
    coordinator.noteStage('reviewing');
    return reservation.kind === 'ready' ? reservation.key : '';
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
    const before = interruptBeforeSubmission();
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
    expect(coordinator.record()).toBeNull();
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

  it('does NOT tell the diner an UNRECORDED acceptance is with the kitchen',
     () => {
    // THE SAME OVER-CLAIM THE BACKEND CARRIED (Codex P2 on backend #318).
    // `evidence_unavailable` means the server CANNOT DETERMINE whether the
    // submission landed — two producers reach it (an acceptance predating
    // the evidence table, and a draft a kitchen write cancelled or
    // advanced) and nothing on the row separates them. Saying "it is with
    // the kitchen" is a claim the server did not make, and it is the
    // dangerous direction: a diner told that about a cancelled draft waits
    // for food nobody is cooking.
    //
    // THE ACTION HAS SINCE CHANGED, and this spec's original expectation is
    // now the WRONG contract. It asserted the basket was cleared — but
    // `finishAcceptedCheckout` also DELETES the recovery record, so the one
    // outcome the server says it CANNOT DETERMINE was the one that
    // destroyed the handle needed to resolve it, and the next reload
    // started clean with permission to order again.
    //
    // The conservative intent is preserved and strengthened: nothing is
    // retired, and a second checkout is refused by `checkoutBlocked` — the
    // protection that was actually doing the work. The CLAIM assertions
    // below are unchanged.
    interruptMidSubmission();
    api.get.and.returnValue(of({ data: {
      id: 'o1',
      accepted: false,
      checkout: {
        order_id: 'o1',
        intent_key: coordinator.record()?.key ?? null,
        scope: { restaurant: '', table: '' },
        acceptance: { state: 'evidence_unavailable', outcome: null,
                      quote_ref: null, accepted_at: null },
        current: { order_status: 'cancelled', fulfilment_status: 'new',
                   cancelled_at: '2026-09-12T10:00:00+00:00',
                   served_at: null },
        checkout_protocol: 3,
      },
    } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('accepted-unrecorded');
    // NOTHING IS RETIRED on an outcome the server could not determine.
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(coordinator.record()).not.toBeNull();
    // and the CTA, not an emptied basket, is what refuses a second checkout
    expect(component.checkoutBlocked).toBeTrue();
    // the sentence must still not assert what the server could not
    const said = notice() || '';
    expect(said).not.toContain('is with the kitchen');
    expect(said.toLowerCase()).toContain('may');
    expect(said.toLowerCase()).toContain('staff');
  });

  it('still states a CONFIRMED acceptance plainly', () => {
    // The negative control for the spec above: narrowing the unrecorded
    // case must not hedge the one the server really did confirm.
    interruptMidSubmission();
    api.get.and.returnValue(of({ data: {
      id: 'o1',
      accepted: true,
      checkout: {
        order_id: 'o1',
        intent_key: coordinator.record()?.key ?? null,
        scope: { restaurant: '', table: '' },
        acceptance: { state: 'accepted', outcome: null,
                      quote_ref: 'q1',
                      accepted_at: '2026-09-12T10:00:00+00:00' },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
    } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('accepted');
    expect(notice()).toContain('already placed');
    expect(notice()).toContain('with the kitchen');
  });

  // -- the three P1s from the Codex review of #664 -----------------------

  /** A level-3 order-details payload, as the diner's recovery read sees it. */
  const recovered = (acceptance: any, over: any = {}) => ({ data: {
    id: 'o1',
    accepted: acceptance.state === 'accepted',
    checkout_protocol: 3,
    checkout: {
      order_id: 'o1',
      intent_key: coordinator.record()?.key ?? null,
      scope: { restaurant: '', table: '' },
      acceptance: { outcome: null, quote_ref: null, accepted_at: null,
                    ...acceptance },
      current: { order_status: 'initiated', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null },
      checkout_protocol: 3,
      ...over,
    },
  } });

  it('REPLAYS the issued command when the server proves the draft is intact',
     () => {
    // THE DEADLOCK. An acceptance that never reached the server leaves the
    // draft `initiate` created, so recovery reads a DEFINITIVE level-3
    // `not_accepted` — not a 404. The record still holds a command, so
    // Checkout is refused as `outstanding`; if Retry then no-ops on the
    // draft, the diner can never submit that order at all.
    //
    // `not_accepted` is proof of non-execution: the backend writes the
    // evidence row in the SAME transaction as the transition, so "still
    // initiated, no evidence" means the acceptance did not commit. The same
    // command is therefore re-sent under the SAME key — never a fresh one.
    interruptMidSubmission();
    api.get.and.returnValue(of(recovered({ state: 'not_accepted' })) as any);
    fixture.detectChanges();
    expect(component.recovered?.kind).toBe('draft');

    api.postPatch.and.returnValue(of({ status: 200 }) as any);
    component.retryOrder();

    expect(api.postPatch).toHaveBeenCalled();
    const [url, payload] = api.postPatch.calls.mostRecent().args as any[];
    expect(url).toBe('orders/submit/');
    expect(payload.order).toBe('o1');
  });

  it('offers RETRY, not Checkout, on a draft it already has a command for',
     () => {
    // The CTA half of the same defect: `draft` did not block, so the button
    // said Checkout and every press was refused as `outstanding`.
    interruptMidSubmission();
    api.get.and.returnValue(of(recovered({ state: 'not_accepted' })) as any);

    fixture.detectChanges();

    expect(component.checkoutBlocked).toBeTrue();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => (b.textContent || '').trim());
    expect(labels).toContain('Retry');
  });

  it('does NOT auto-submit on load — the diner taps retry', () => {
    // A reload may be how somebody abandons a checkout. Recovery reports;
    // it never places an order on its own.
    interruptMidSubmission();
    api.get.and.returnValue(of(recovered({ state: 'not_accepted' })) as any);

    fixture.detectChanges();

    expect(api.postPatch).not.toHaveBeenCalled();
  });

  it('REFUSES a payload that promised a projection it cannot express', () => {
    // ABSENT AND UNREADABLE ARE DIFFERENT FACTS — the same distinction this
    // repo already draws for `quote_total`. A payload advertising level 3
    // whose projection cannot be read is BROKEN, and trusting the legacy
    // `accepted: true` beside it clears the basket with no key, order or
    // scope ever checked.
    interruptMidSubmission();
    api.get.and.returnValue(of({ data: {
      id: 'o1',
      accepted: true,
      checkout_protocol: 3,
      checkout: { order_id: 'o1', acceptance: { state: 'nonsense' } },
    } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('uncorrelated');
    expect(basketService.clearBasket).not.toHaveBeenCalled();
  });

  it('still falls back when the payload promised NOTHING', () => {
    // The negative control. A pre-level-3 server carries no projection at
    // all, and its `accepted: true` is still definitive — narrowing the
    // broken case must not break compatibility with an older one.
    interruptMidSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: true } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('accepted');
    expect(basketService.clearBasket).toHaveBeenCalled();
  });

  it('leaves an unaccepted draft exactly as it is, for the diner to review', () => {
    // NO ACCEPTANCE WAS ISSUED for this key, so an unaccepted order can only
    // be the draft that initiate created — and this client knows that from
    // its OWN record, without inferring anything from a server that cannot
    // express the distinction.
    interruptBeforeSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: false } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('draft');
    expect(notice()).toContain('unfinished order');
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    // still recoverable — the key is not dropped for a draft
    expect(coordinator.record()).not.toBeNull();
  });

  it('will NOT call an ambiguous level-2 answer a draft after a command', () => {
    // THE CONFLATION, AND WHY THE CORRELATED PROJECTION EXISTS. At protocol
    // 2 `accepted: false` covers a genuine draft AND an order accepted
    // before the evidence table existed — the server's own docstring says
    // so. With an acceptance outstanding, calling it a draft would invite
    // the diner to place an order that is already in the kitchen.
    interruptMidSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: false } }) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('unsupported');
    expect(notice()).toContain('still confirming');
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(coordinator.record()).not.toBeNull();
  });

  it('KEEPS the record when the server says the attempt never arrived', () => {
    // THIS CONTRACT DELIBERATELY MOVED. It used to drop the key here, on the
    // reading that a proven absence means nothing to recover. But NOT FOUND
    // IS NOT PROOF OF NON-EXECUTION in general, and even where it is — a
    // supported server, a proven scope, no matching row — what it licenses
    // is a SAME-KEY, SAME-REQUEST replay, never a different key. One
    // momentary observation must not discard the identity of a checkout.
    const key = interruptMidSubmission();
    api.get.and.returnValue(throwError(() => ({ status: 404 })) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('absent');
    expect(coordinator.record()!.key).toBe(key);
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    // AND THE DINER IS TOLD. Silence used to be the answer here, beside a
    // basket they might be about to re-order.
    //
    // THE WORDING MOVED with the same reasoning this spec's own header
    // gives: "did not reach us" ASSERTS non-execution, which a not-found at
    // one instant does not establish. What it licenses is a same-key,
    // same-request replay — so that is what the sentence now offers, and
    // the old phrasing is pinned ABSENT so it cannot drift back.
    expect(notice()).not.toContain('did not reach us');
    expect((notice() || '').toLowerCase()).toContain('same order again');
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
    expect(coordinator.record()!.key).toBe(key);
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    // AND IT SAYS SO. A blank screen beside a basket the diner may be about
    // to re-order is the worst of the available answers.
    expect(notice()).toContain('still confirming');
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
    // A DRAFT is resolvable by simply checking out again, so the notice
    // that described it goes with the new attempt. (An OUTSTANDING
    // ACCEPTANCE is not — see the spec below.)
    interruptBeforeSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: false } }) as any);
    fixture.detectChanges();
    expect(component.recoveryNotice).not.toBeNull();

    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();

    expect(component.recoveryNotice).toBeNull();
  });

  it('REFUSES a second checkout while an acceptance is outstanding', () => {
    // THE RECORD OF AN ISSUED COMMAND IS WHAT RESOLVES IT, so starting
    // another checkout — which would overwrite that record with a fresh key
    // — is exactly what must not happen. The previous version did precisely
    // that whenever the basket or the table had changed.
    interruptMidSubmission();
    api.get.and.returnValue(throwError(() => ({ status: 0 })) as any);
    fixture.detectChanges();

    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();

    expect(api.postPatch).not.toHaveBeenCalled();
    expect(component.orderError).toBeTrue();
    expect(coordinator.record()!.command)
      .toEqual({ orderId: 'o1', quoteRef: 'q1' });
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

  // -- the stage is recorded as it advances ------------------------------

  it('records the review stage, and NO command — nothing is accepted yet', () => {
    // The command is what a recovery replays, so recording one while the
    // diner is still reading the quote would make an unread draft look like
    // an outstanding acceptance and block the next checkout behind it.
    api.postPatch.and.returnValue(of(initiated()) as any);

    component.initiateOrder();

    const record = coordinator.record()!;
    expect(record.stage).toBe('reviewing');
    expect(record.command).toBeNull();
  });

  it('forgets the attempt only on a definitive success', () => {
    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    expect(coordinator.record()).not.toBeNull();
    expect(component.quoteIsUnreadable)
      .withContext('the fixture must be confirmable').toBeFalse();

    // a failed submission keeps it — the outcome is unknown, which is
    // precisely when the key must survive
    api.postPatch.and.returnValue(throwError(() => 'no network') as any);
    component.confirmQuote();
    expect(coordinator.record()).not.toBeNull();

    api.postPatch.and.returnValue(of({}) as any);
    component.confirmQuote();
    expect(coordinator.record()).toBeNull();
  });

  // -- the issued command is replayed, never re-placed -------------------

  describe('retrying after an uncertain acceptance', () => {
    it('REPLAYS the issued command instead of placing a new order', () => {
      // THE DEFECT. `retryOrder()` called `placeOrder()` unconditionally,
      // which rebuilds the request from the LIVE basket and re-runs
      // `initiate` — so a retry after an uncertain ACCEPTANCE asked the
      // server a different question from the one whose answer was lost, and
      // any basket edit in between silently changed what was being retried.
      interruptMidSubmission();
      api.get.and.returnValue(throwError(() => ({ status: 404 })) as any);
      api.postPatch.and.returnValue(of({ status: 200 }) as any);

      component.retryOrder();

      // it asked first, and then re-sent the RECORDED command
      expect(api.get).toHaveBeenCalled();
      const [url, body, verb] = api.postPatch.calls.mostRecent().args as any;
      expect(url).toBe('orders/submit/');
      expect(verb).toBe('put');
      expect(body).toEqual({ order: 'o1', quote_ref: 'q1' });
    });

    it('does not re-send when the acceptance is found to have landed', () => {
      interruptMidSubmission();
      api.get.and.returnValue(
        of({ data: { id: 'o1', accepted: true } }) as any);
      api.postPatch.calls.reset();

      component.retryOrder();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(component.recovered?.kind).toBe('accepted');
      expect(basketService.clearBasket).toHaveBeenCalled();
      expect(coordinator.record()).toBeNull();
    });

    it('keeps the record when the retry itself cannot be resolved', () => {
      // A failure to re-send says nothing about whether the first one
      // landed, so the checkout stays unresolved and recoverable.
      const key = interruptMidSubmission();
      api.get.and.returnValue(throwError(() => ({ status: 0 })) as any);
      api.postPatch.calls.reset();

      component.retryOrder();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(coordinator.record()!.key).toBe(key);
      expect(coordinator.record()!.command)
        .toEqual({ orderId: 'o1', quoteRef: 'q1' });
    });
  });

  // -- the outcome is validated before it is announced -------------------

  describe('announcing a submit outcome', () => {
    function reviewed(): void {
      api.postPatch.and.returnValue(of(initiated()) as any);
      component.initiateOrder();
      api.postPatch.calls.reset();
    }

    const accepted = (over: Record<string, unknown> = {}) => ({
      status: 200,
      checkout: {
        order_id: 'o9',
        intent_key: coordinator.record()?.key ?? null,
        scope: (component as any).checkoutContext().split(':')[0] === ''
          ? { restaurant: null, table: null }
          : { restaurant: 'r', table: 't' },
        acceptance: {
          state: 'accepted', outcome: 'newly_accepted',
          quote_ref: 'qref-9', accepted_at: '2026-09-12T10:00:00+00:00',
        },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
        ...over,
      },
    });

    it('records the terminal outcome BEFORE clearing the record', () => {
      // If the process dies between the two, a reload must read a completed
      // checkout and say so — not re-enquire about an order in the kitchen.
      reviewed();
      const writes: string[] = [];
      const real = coordinator.recordOutcome.bind(coordinator);
      spyOn(coordinator, 'recordOutcome').and.callFake((outcome) => {
        writes.push('record');
        return real(outcome);
      });
      spyOn(coordinator, 'clearIntent').and.callFake(() => {
        writes.push('clear');
      });
      api.postPatch.and.returnValue(of(accepted()) as any);

      component.confirmQuote();

      expect(writes).toEqual(['record', 'clear']);
    });

    it('carries the SERVER\'s original reference into the record', () => {
      reviewed();
      let saved: any = null;
      const real = coordinator.recordOutcome.bind(coordinator);
      spyOn(coordinator, 'recordOutcome').and.callFake((outcome) => {
        saved = outcome;
        return real(outcome);
      });
      api.postPatch.and.returnValue(of(accepted()) as any);

      component.confirmQuote();

      expect(saved.orderId).toBe('o9');
      expect(saved.quoteRef).toBe('qref-9');
      expect(saved.acceptedAt).toBe('2026-09-12T10:00:00+00:00');
    });

    it('REFUSES to announce an answer about a different order', () => {
      reviewed();
      api.postPatch.and.returnValue(
        of(accepted({ order_id: 'somebody-elses' })) as any);

      component.confirmQuote();

      expect(basketService.clearBasket).not.toHaveBeenCalled();
      expect(component.orderError).toBeTrue();
      expect(component.recovered?.kind).toBe('uncorrelated');
    });

    it('REFUSES to announce an answer naming a different key', () => {
      reviewed();
      api.postPatch.and.returnValue(
        of(accepted({ intent_key: 'somebody-elses' })) as any);

      component.confirmQuote();

      expect(basketService.clearBasket).not.toHaveBeenCalled();
      expect(component.orderError).toBeTrue();
    });

    it('still announces an uncorrelated-level answer, as before', () => {
      // A level-2 server publishes no projection, so there is nothing to
      // check and the reply is taken exactly as it was.
      reviewed();
      api.postPatch.and.returnValue(of({ status: 200 }) as any);

      component.confirmQuote();

      expect(basketService.clearBasket).toHaveBeenCalled();
    });

    it('REFUSES a submit reply that promised a projection it cannot express',
       () => {
      // The submit surface has the same hole as the recovery read, and the
      // available signal here is the `checkout` key itself: the backend
      // publishes it TOP-LEVEL on this response (beside status / message /
      // idempotent), so present-but-unreadable is a broken promise while
      // absent is simply an older server.
      reviewed();
      api.postPatch.and.returnValue(of({
        status: 200,
        checkout: { order_id: 'o9', acceptance: { state: 'nonsense' } },
      }) as any);

      component.confirmQuote();

      expect(basketService.clearBasket).not.toHaveBeenCalled();
      expect(component.orderError).toBeTrue();
      expect(component.recovered?.kind).toBe('uncorrelated');
    });

    it('KEEPS the intent when the terminal outcome cannot be recorded', () => {
      // `recordOutcome` exists to report a failed durable write, and
      // ignoring its answer reopens the very defect this PR closed: a store
      // that silently drops writes loses the accepted outcome while the
      // REMOVAL still succeeds, so a reload finds no record at all and can
      // start a second checkout for an order already in the kitchen.
      //
      // The order DID land, so success is still announced — only the
      // cleanup is withheld, and the surviving record is what makes a later
      // reload recover `accepted` and tidy up then.
      reviewed();
      api.postPatch.and.returnValue(of(accepted()) as any);
      spyOn(coordinator, 'recordOutcome').and.returnValue(false);
      const cleared = spyOn(coordinator, 'clearIntent').and.callThrough();

      component.confirmQuote();

      expect(cleared).not.toHaveBeenCalled();
      // the diner is still told their order was placed
      expect(basketService.clearBasket).toHaveBeenCalled();
      expect(component.orderError).toBeFalse();
    });

    it('clears the intent when the outcome WAS recorded', () => {
      // The negative control for the spec above.
      reviewed();
      api.postPatch.and.returnValue(of(accepted()) as any);
      const cleared = spyOn(coordinator, 'clearIntent').and.callThrough();

      component.confirmQuote();

      expect(cleared).toHaveBeenCalled();
    });

    it('REPRICES after a stale-quote refusal instead of dead-ending', () => {
      // THE FIFTH P1, and the one my own draft-replay fix made WORSE rather
      // than better. `quote_ref_stale` is a DEFINITIVE refusal — the server
      // re-read the order under its lock and the reference does not match, so
      // this command can never be accepted — and the branch promises a
      // reprice. But the record still said `accepting` with a command, so
      // `reserveIntent` answered `outstanding` and refused to start one.
      //
      // The loop that follows: Checkout refused as outstanding → Retry →
      // `replayIssuedCommand` → the order is still a draft → (since the draft
      // fix) re-send the SAME permanently-refused command → stale again.
      // Before that fix it no-opped instead. Either way the diner can never
      // see the new quote.
      //
      // THE KEY IS RETAINED. The basket has not changed, so this is the same
      // purchase and must keep its idempotency key; only the COMMAND is
      // settled. `sameCommand` then hands the same key straight back.
      reviewed();
      const keyBefore = coordinator.record()?.key;
      api.postPatch.and.callFake((url: string) => (
        url.includes('orders/submit')
          ? throwError(() => ({ status: 400, reason: 'quote_ref_stale',
                                message: 'Your order total changed.' }))
          : of(initiated())
      ) as any);

      component.confirmQuote();

      const urls = api.postPatch.calls.allArgs().map((a: any[]) => a[0]);
      expect(urls.some((u: string) => u.includes('orders/initiate')))
        .withContext('the promised reprice must actually be issued').toBeTrue();
      expect(coordinator.record()?.key).toBe(keyBefore!);
      expect(coordinator.isOutstanding(coordinator.record()!)).toBeFalse();
    });

    it('does NOT reprice when the settle cannot be recorded', () => {
      // The durable-write rule, applied to this transition too: if the
      // refused command cannot be written down as settled, starting a fresh
      // priced attempt would leave a record still naming a command nobody
      // will resolve. Nothing is sent.
      reviewed();
      api.postPatch.and.callFake((url: string) => (
        url.includes('orders/submit')
          ? throwError(() => ({ status: 400, reason: 'quote_ref_stale',
                                message: 'Your order total changed.' }))
          : of(initiated())
      ) as any);
      spyOn(coordinator, 'settleRefusedCommand').and.returnValue(false);

      component.confirmQuote();

      const urls = api.postPatch.calls.allArgs().map((a: any[]) => a[0]);
      expect(urls.some((u: string) => u.includes('orders/initiate'))).toBeFalse();
      expect(component.orderError).toBeTrue();
    });

    it('will not send an acceptance it cannot record durably', () => {
      // A command held only in memory cannot be replayed after the reload
      // that is the most likely response to a stuck checkout, so nothing is
      // sent at all.
      reviewed();
      spyOn(coordinator, 'noteCommand').and.returnValue(false);

      component.confirmQuote();

      expect(api.postPatch).not.toHaveBeenCalled();
      expect(component.orderError).toBeTrue();
    });
  });

  // -- targeted cleanup, never a blanket wipe ----------------------------

  it('does NOT clear the whole session store on a successful order', () => {
    // THE DEFECT. `retainSessionThrough(() => sessionStorage.clear())`
    // emptied EVERY key on the origin — prefixed or not, this app's or not
    // — and then put two diner tokens back by hand. That restore list has
    // to be maintained against a wipe that keeps widening, and it was
    // already wrong for the portal-embedded diner mount, where an
    // operator's own session keys sit in the same store.
    window.sessionStorage.setItem('somebody-elses', 'keep me');
    window.sessionStorage.setItem('Table', JSON.stringify({ value: { id: 't' } }));
    window.sessionStorage.setItem('upsellConfig', JSON.stringify({ value: {} }));

    api.postPatch.and.returnValue(of(initiated()) as any);
    component.initiateOrder();
    api.postPatch.and.returnValue(of({ status: 200 }) as any);
    component.confirmQuote();

    expect(window.sessionStorage.getItem('somebody-elses')).toBe('keep me');
    // the diner's own context survives, so "back to menu" needs no re-scan
    expect(window.sessionStorage.getItem('Table')).not.toBeNull();
    // and only the per-order browse state is dropped
    expect(window.sessionStorage.getItem('upsellConfig')).toBeNull();

    window.sessionStorage.removeItem('somebody-elses');
    window.sessionStorage.removeItem('Table');
  });


  it('offers RETRY rather than Checkout while a checkout is unresolved', () => {
    // Tapping Checkout with an acceptance outstanding is refused anyway,
    // so offering the button that does the right thing beats offering one
    // that explains why it will not.
    interruptMidSubmission();
    api.get.and.returnValue(throwError(() => ({ status: 0 })) as any);

    fixture.detectChanges();

    expect(component.checkoutBlocked).toBeTrue();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => (b.textContent || '').trim());
    expect(labels).toContain('Retry');
    expect(labels.some((l) => l.startsWith('Checkout'))).toBeFalse();
  });

  it('offers Checkout again once the outcome is a resolvable draft', () => {
    interruptBeforeSubmission();
    api.get.and.returnValue(
      of({ data: { id: 'o1', accepted: false } }) as any);

    fixture.detectChanges();

    expect(component.checkoutBlocked).toBeFalse();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => (b.textContent || '').trim());
    expect(labels.some((l) => l.startsWith('Checkout'))).toBeTrue();
  });

});
