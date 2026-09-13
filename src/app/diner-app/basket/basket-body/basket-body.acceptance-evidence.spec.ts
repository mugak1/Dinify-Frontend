/**
 * D04 Gate A — VERIFY ACCEPTANCE, NOT MERELY RESOURCE IDENTITY.
 *
 * `correlationMatches()` answers "is this answer ABOUT my command?" — key,
 * order and scope. `submitOrder()` and `resendIssuedCommand()` then used that
 * single predicate as their SUCCESS decision and went straight to
 * `recordOutcome({kind: 'accepted'})`. Those are different questions. A
 * projection can name this key, this order and this scope and still say the
 * acceptance did NOT happen, or name a different quote than the one the diner
 * confirmed, or carry no evidence at all.
 *
 * ALL FIXTURES HERE ARE SYNTHETIC. They are hand-built response bodies, not
 * observed backend output: today's corrected server does not normally emit a
 * `not_accepted` projection in reply to a submit. What is being pinned is what
 * THIS CLIENT does when one arrives — a late reply, a misrouted proxy, a
 * partially-deployed fleet — because the client is what decides whether a
 * diner is told their food is coming.
 *
 * They are driven through the REAL component handler, storage and coordinator,
 * not a pure parser: the defect is what the caller does next.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

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

describe('BasketBodyComponent — acceptance evidence (D04 Gate A)', () => {
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

  beforeEach(async () => {
    basket = { items: [line()], totalAmount: 5000 };
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch', 'get']);
    api.postPatch.and.returnValue(of() as any);
    api.get.and.returnValue(of({ data: null }) as any);
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);

    basketService = {
      Basket: () => basket,
      clearBasket: jasmine.createSpy('clearBasket'),
      revision: () => 3,
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

  /** The initiate reply. `checkout_protocol` is what the server states it can
   *  promise (backend D04/B) — the client is expected to remember it. */
  const initiated = (over: Record<string, unknown> = {}) => ({
    status: 200,
    data: {
      order_details: {
        id: 'o9', quote_ref: 'qref-9', actual_cost: 5000,
        no_items: 1, no_available_items: 1, no_unavailable_items: 0,
        no_available_extras: 0, no_unavailable_extras: 0,
        checkout_protocol: 3, ...over,
      },
      unavailable_items: [] as unknown[], unavailable_extras: [] as unknown[],
    },
  });

  /** Price a draft so a command can be issued for it. */
  function reviewed(over: Record<string, unknown> = {}): void {
    api.postPatch.and.returnValue(of(initiated(over)) as any);
    component.initiateOrder();
    api.postPatch.calls.reset();
  }

  /** A well-formed level-3 submit reply, overridable field by field. */
  const reply = (acceptance: Record<string, unknown> = {},
                 over: Record<string, unknown> = {}) => ({
    status: 200,
    checkout: {
      order_id: 'o9',
      intent_key: coordinator.record()?.key ?? null,
      scope: { restaurant: null, table: null },
      acceptance: {
        state: 'accepted', outcome: 'newly_accepted',
        quote_ref: 'qref-9', accepted_at: '2026-09-12T10:00:00+00:00',
        ...acceptance,
      },
      current: { order_status: 'pending', fulfilment_status: 'new',
                 cancelled_at: null, served_at: null },
      checkout_protocol: 3,
      ...over,
    },
  });

  /** No acceptance may have been announced, persisted or acted on. */
  function assertNotAccepted(): void {
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(component.recovered?.kind).not.toBe('accepted');
    expect(coordinator.record()).not.toBeNull();
    expect(coordinator.record()!.stage).not.toBe('accepted');
    expect(coordinator.record()!.outcome).toBeNull();
  }

  // -- 1. the projection says the acceptance did NOT happen ---------------

  it('refuses a not_accepted projection that names this exact command', () => {
    // The identity check passes completely — right key, right order, right
    // scope — and the server is saying the order is still a draft. Treating
    // a resource match as a success decision announces an order the server
    // has just said it did not accept.
    reviewed();
    api.postPatch.and.returnValue(of(reply({
      state: 'not_accepted', outcome: null,
      quote_ref: null, accepted_at: null,
    })) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  // -- 2. accepted, but not the quote the diner confirmed -----------------

  it('refuses an acceptance bound to a DIFFERENT reference than the one '
     + 'issued', () => {
    // The diner confirmed `qref-9`; the server reports an acceptance bound to
    // `qref-other`. That is a real conflict about what was agreed, not a
    // successful completion of this command.
    reviewed();
    api.postPatch.and.returnValue(
      of(reply({ quote_ref: 'qref-other' })) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  // -- 3/4. accepted with no usable evidence ------------------------------

  it('refuses an accepted state carrying no reference', () => {
    reviewed();
    api.postPatch.and.returnValue(of(reply({ quote_ref: null })) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  it('refuses an accepted state carrying no acceptance time', () => {
    reviewed();
    api.postPatch.and.returnValue(of(reply({ accepted_at: null })) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  it('refuses a MUTATION reply whose acceptance names no outcome', () => {
    // `outcome: null` is legitimate on a READ — an observation is not the
    // result of an attempt. On the reply to an acceptance command it is
    // contradictory: the server performed an attempt and did not say which.
    reviewed();
    api.postPatch.and.returnValue(of(reply({ outcome: null })) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  // -- 5. a server known to speak level 3 that then says nothing ----------

  it('does not fall back to the legacy reading once level 3 was established '
     + 'for this attempt', () => {
    // The initiate reply stated `checkout_protocol: 3`. A submit reply from
    // that same server carrying no projection at all is therefore BROKEN, not
    // an older server — and the legacy branch would clear the basket having
    // validated no key, no order and no scope.
    reviewed();
    api.postPatch.and.returnValue(of({ status: 200 }) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  it('does not fall back when a known level-3 server sends a null checkout',
     () => {
    reviewed();
    api.postPatch.and.returnValue(of({ status: 200, checkout: null }) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  // -- 6. wrong scope -----------------------------------------------------

  it('refuses an acceptance resolved at a different scope', () => {
    reviewed();
    api.postPatch.and.returnValue(of(reply({}, {
      scope: { restaurant: 'other-restaurant', table: 'other-table' },
    })) as any);

    component.confirmQuote();

    assertNotAccepted();
  });

  // -- 7. the cases that MUST still succeed (controls) --------------------

  it('accepts a complete newly_accepted answer and keeps the server\'s own '
     + 'reference and time', () => {
    reviewed();
    let saved: any = null;
    const real = coordinator.recordOutcome.bind(coordinator);
    spyOn(coordinator, 'recordOutcome').and.callFake((outcome) => {
      saved = outcome;
      return real(outcome);
    });
    api.postPatch.and.returnValue(of(reply()) as any);

    component.confirmQuote();

    expect(basketService.clearBasket).toHaveBeenCalled();
    expect(saved.orderId).toBe('o9');
    expect(saved.quoteRef).toBe('qref-9');
    expect(saved.acceptedAt).toBe('2026-09-12T10:00:00+00:00');
  });

  it('accepts a same-command replay labelled already_accepted', () => {
    reviewed();
    api.postPatch.and.returnValue(
      of(reply({ outcome: 'already_accepted' })) as any);

    component.confirmQuote();

    expect(basketService.clearBasket).toHaveBeenCalled();
  });

  // -- 8. THE SAME EVIDENCE RULE, AT THE RECOVERY CONSUMERS (D04 R1) ------
  //
  // `submitVerdict()` learned the difference between identity and acceptance
  // on PR #665; `classify()` did not, so the startup and Retry consumers
  // could complete exactly the answers the block above refuses. These drive
  // the REAL recovery subscription — `ngOnInit` for startup, `retryOrder()`
  // for Retry — rather than calling the classifier directly.

  /** An order READ carrying a level-3 projection in the `data` envelope. */
  const readBody = (acceptance: Record<string, unknown>) => ({
    data: {
      checkout_protocol: 3,
      checkout: {
        order_id: 'o9',
        intent_key: coordinator.record()?.key ?? null,
        scope: { restaurant: null, table: null },
        acceptance: {
          state: 'accepted', outcome: null,
          quote_ref: 'qref-9', accepted_at: '2026-09-13T10:00:00+00:00',
          ...acceptance,
        },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null },
        checkout_protocol: 3,
      },
    },
  });

  /** Leave the tab exactly as an interrupted submission leaves it: a keyed
   *  intent at this scope with order `o9` / reference `qref-9` issued, and a
   *  server that has already stated level 3 for the attempt. */
  function interrupted(): void {
    coordinator.reserveIntent(
      { identity: basketService.contentIdentity(), canon: PURCHASE_CANON },
      ':');
    coordinator.noteProtocol(3);
    coordinator.noteCommand({ orderId: 'o9', quoteRef: 'qref-9' });
  }

  /** Nothing may have been announced, persisted or cleaned up. */
  function assertRecoveryRefused(): void {
    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(component.recovered?.kind).not.toBe('accepted');
    expect(coordinator.record()).not.toBeNull();
    expect(coordinator.record()!.outcome).toBeNull();
  }

  const REFUSED_EVIDENCE: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['an acceptance bound to a DIFFERENT reference',
     { quote_ref: 'qref-other' }],
    ['an accepted state carrying no reference', { quote_ref: null }],
    ['an accepted state carrying no acceptance time', { accepted_at: null }],
  ];

  for (const [label, acceptance] of REFUSED_EVIDENCE) {
    it(`STARTUP recovery refuses ${label}`, () => {
      interrupted();
      api.get.and.returnValue(of(readBody(acceptance)) as any);

      fixture.detectChanges();                       // runs ngOnInit

      assertRecoveryRefused();
    });

    it(`RETRY recovery refuses ${label}`, () => {
      interrupted();
      api.get.and.returnValue(of(readBody(acceptance)) as any);

      component.retryOrder();

      assertRecoveryRefused();
    });
  }

  it('STARTUP recovery does not downgrade once level 3 was established',
     () => {
    interrupted();
    api.get.and.returnValue(of({ data: { id: 'o9', accepted: true } }) as any);

    fixture.detectChanges();

    assertRecoveryRefused();
  });

  it('RETRY recovery does not downgrade once level 3 was established', () => {
    interrupted();
    api.get.and.returnValue(of({ data: { id: 'o9', accepted: true } }) as any);

    component.retryOrder();

    assertRecoveryRefused();
  });

  it('STARTUP recovery still completes a usable answer with a null outcome',
     () => {
    // The recovery control: an observation is not the result of an attempt.
    interrupted();
    api.get.and.returnValue(of(readBody({ outcome: null })) as any);

    fixture.detectChanges();

    expect(component.recovered?.kind).toBe('accepted');
    expect(basketService.clearBasket).toHaveBeenCalled();
  });

  it('still accepts a genuinely pre-level-3 server, which promised nothing',
     () => {
    // THE COMPATIBILITY CONTROL. A server that never stated a level and sends
    // no projection is an older one, and its reply is taken as before. This
    // must keep passing, or Gate A has broken the deploy window rather than
    // closing a hole.
    reviewed({ checkout_protocol: undefined });
    api.postPatch.and.returnValue(of({ status: 200 }) as any);

    component.confirmQuote();

    expect(basketService.clearBasket).toHaveBeenCalled();
  });
});
