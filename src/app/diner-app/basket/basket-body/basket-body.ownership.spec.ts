/**
 * D04 Gate B — ONE OWNER MUST RETAIN UNCERTAINTY AND SCOPE COMPLETION.
 *
 * Three distinct failures, all of them in the direction that loses the
 * protection rather than the one that annoys the diner:
 *
 *  1. UNKNOWN EVIDENCE WAS TREATED AS A FINISHED CHECKOUT. The backend
 *     defines `evidence_unavailable` as inability to determine whether the
 *     submission landed. Both recovery paths handed it to
 *     `finishAcceptedCheckout()`, which clears the basket AND deletes the
 *     recovery record — so the one outcome that most needs the record to
 *     survive was the one that destroyed it, and the next reload started
 *     clean with permission to order again.
 *
 *  2. COMPLETION WAS NOT SCOPED TO THE OPERATION IT BELONGED TO. Recovery
 *     callbacks performed destructive cleanup without checking that the
 *     record and cart they captured still owned the state being cleared.
 *
 *  3. A REPLAY REBUILT THE REQUEST FROM THE LIVE BASKET. `PurchaseRequest`
 *     carried identity and canon only, so a retry after a lost INITIATE sent
 *     whatever the basket held by then rather than what was originally
 *     validated and sent.
 *
 * Storage and malformed-response fixtures here are SYNTHETIC. The interleaving
 * they stand for — a reply arriving after the diner has moved on — is not.
 */
import {
  ComponentFixture, TestBed, fakeAsync, tick,
} from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';

import { WINDOW } from '../../../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../../../_services/storage/storage-key-prefix.token';
import { BasketService } from '../../../_services/basket.service';
import { ApiService } from '../../../_services/api.service';
import {
  CheckoutCoordinatorService, PURCHASE_CANON,
} from '../../../_services/checkout-coordinator.service';
import {
  SessionStorageService,
} from '../../../_services/storage/session-storage.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConfirmDialogService } from '../../../_common/confirm-dialog.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { BasketItem } from '../../../_models/app.models';
import { BasketBodyComponent } from './basket-body.component';

describe('BasketBodyComponent — operation ownership (D04 Gate B)', () => {
  let basket: { items: BasketItem[]; totalAmount: number };
  let api: jasmine.SpyObj<ApiService>;
  let basketService: any;
  let coordinator: CheckoutCoordinatorService;
  let storage: SessionStorageService;
  let fixture: ComponentFixture<BasketBodyComponent>;
  let component: BasketBodyComponent;

  const line = (itemId = 'i1', quantity = 1) => ({
    itemId, itemName: 'Burger', basePrice: 5000, totalPrice: 5000,
    quantity, selectedModifiers: [], extras: [], isDiscounted: false,
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
    storage = TestBed.inject(SessionStorageService);
    fixture = TestBed.createComponent(BasketBodyComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    window.sessionStorage.removeItem(CheckoutCoordinatorService.ATTEMPT_KEY);
  });

  /** Leave the tab exactly as an interrupted submission leaves it. */
  function interrupted(): string {
    const reservation = coordinator.reserveIntent(
      { identity: basketService.contentIdentity(), canon: PURCHASE_CANON },
      ':');
    coordinator.noteCommand({ orderId: 'o1', quoteRef: 'q1' });
    return reservation.kind === 'ready' ? reservation.key : '';
  }

  /** An order read carrying a level-3 projection in the `data` envelope. */
  const read = (acceptance: Record<string, unknown>,
                current: Record<string, unknown> = {}) => ({
    data: {
      checkout_protocol: 3,
      checkout: {
        order_id: 'o1',
        intent_key: coordinator.record()?.key ?? null,
        scope: { restaurant: null, table: null },
        acceptance: {
          state: 'accepted', outcome: null,
          quote_ref: 'q1', accepted_at: '2026-09-12T10:00:00+00:00',
          ...acceptance,
        },
        current: { order_status: 'pending', fulfilment_status: 'new',
                   cancelled_at: null, served_at: null, ...current },
        checkout_protocol: 3,
      },
    },
  });

  // -- 1. unknown evidence stays unresolved -------------------------------

  describe('evidence_unavailable', () => {
    const unavailable = () => read({
      state: 'evidence_unavailable', outcome: null,
      quote_ref: null, accepted_at: null,
    });

    it('does NOT delete the recovery record on startup recovery', () => {
      // The server has said it cannot determine whether the submission
      // landed. Deleting the record removes the only handle that could ever
      // resolve it — the protection, discarded by the branch meant to be
      // conservative.
      const key = interrupted();
      api.get.and.returnValue(of(unavailable()) as any);

      fixture.detectChanges();

      expect(component.recovered?.kind).toBe('accepted-unrecorded');
      expect(coordinator.record()).not.toBeNull();
      expect(coordinator.record()!.key).toBe(key);
    });

    it('does NOT clear the basket on startup recovery', () => {
      interrupted();
      api.get.and.returnValue(of(unavailable()) as any);

      fixture.detectChanges();

      expect(basketService.clearBasket).not.toHaveBeenCalled();
    });

    it('does NOT delete the record on the Retry path either', () => {
      const key = interrupted();
      fixture.detectChanges();
      api.get.and.returnValue(of(unavailable()) as any);

      component.retryOrder();

      expect(coordinator.record()).not.toBeNull();
      expect(coordinator.record()!.key).toBe(key);
    });

    it('still refuses a replacement checkout after a reload', () => {
      // The reload is the point: an unresolved outcome must not become
      // permission to start a second checkout just because the page moved.
      interrupted();
      api.get.and.returnValue(of(unavailable()) as any);
      fixture.detectChanges();

      const again = coordinator.reserveIntent(
        { identity: 'a-completely-different-basket', canon: PURCHASE_CANON },
        ':');

      expect(again.kind).toBe('outstanding');
    });

    it('sends no acceptance of its own', () => {
      interrupted();
      api.get.and.returnValue(of(unavailable()) as any);
      api.postPatch.calls.reset();

      fixture.detectChanges();

      expect(api.postPatch).not.toHaveBeenCalled();
    });
  });

  // -- 2. an acceptance and a later cancellation are separate facts -------

  describe('truthful current state', () => {
    it('does not claim the kitchen has an order that was cancelled', () => {
      interrupted();
      api.get.and.returnValue(of(read({}, {
        order_status: 'cancelled', fulfilment_status: 'new',
        cancelled_at: '2026-09-12T10:05:00+00:00',
      })) as any);

      fixture.detectChanges();

      expect(component.recovered?.kind).toBe('accepted');
      expect(component.recoveryNotice)
        .not.toContain('it is with the kitchen');
      expect((component.recoveryNotice || '').toLowerCase())
        .toContain('cancel');
    });

    it('does not claim a served order is still being prepared', () => {
      interrupted();
      api.get.and.returnValue(of(read({}, {
        order_status: 'served', fulfilment_status: 'served',
        served_at: '2026-09-12T10:30:00+00:00',
      })) as any);

      fixture.detectChanges();

      expect(component.recoveryNotice)
        .not.toContain('it is with the kitchen');
    });

    it('keeps the ORIGINAL reference and time when the order later moved',
       () => {
      interrupted();
      api.get.and.returnValue(of(read({}, {
        order_status: 'cancelled',
        cancelled_at: '2026-09-12T10:05:00+00:00',
      })) as any);

      fixture.detectChanges();

      const correlation = (component.recovered as any)?.correlation;
      expect(correlation?.acceptance.quoteRef).toBe('q1');
      expect(correlation?.acceptance.acceptedAt)
        .toBe('2026-09-12T10:00:00+00:00');
    });
  });

  // -- 3. a late recovery answer must not clear newer state ---------------

  it('does not clear a NEWER basket when a held recovery answer lands', () => {
    // Hold the read open, let the diner move on, then deliver the old
    // answer. Its completion belongs to an operation that is no longer the
    // current one, and clearing on the strength of it destroys live state.
    interrupted();
    const held = new Subject<any>();
    api.get.and.returnValue(held as unknown as Observable<any>);

    fixture.detectChanges();               // recovery is now in flight

    // The diner edits the basket and the scope moves on beneath it.
    basket.items = [line('i2', 4)];
    (component as any).restaurant = { id: 'r2' };
    (component as any).table = { id: 't2' };

    held.next(read({}).data ? { data: read({}).data } : null);
    held.complete();

    expect(basketService.clearBasket).not.toHaveBeenCalled();
  });

  // -- 4. one owner across two mounted components -------------------------

  it('does not let a second mounted basket run its own recovery cleanup',
     () => {
    // The desktop sidebar and the routed page are two instances. Only the
    // routed one resumes, and completion must be owned once.
    interrupted();
    api.get.and.returnValue(of(read({}) as any));

    const second = TestBed.createComponent(BasketBodyComponent);
    (second.componentInstance as any).sidebar = true;
    second.detectChanges();

    expect(basketService.clearBasket).not.toHaveBeenCalled();
    expect(coordinator.record()).not.toBeNull();
  });

  // -- 5. a failure after acceptance is a LOCAL error, not a failed order --

  it('does not invite a new purchase when cleanup fails after acceptance',
     () => {
    interrupted();
    api.get.and.returnValue(of(read({}) as any));
    spyOn(coordinator, 'recordOutcome').and.returnValue(false);

    fixture.detectChanges();

    // The order landed. The record must survive so a reload recovers it,
    // and nothing may present this as a fresh checkout opportunity.
    expect(coordinator.record()).not.toBeNull();
  });

  // -- 6. a replay sends the request that was issued ----------------------

  it('replays the ORIGINAL request after a lost initiate, not the edited '
     + 'basket', () => {
    // A lost initiate response leaves a reserved key and no command. The
    // retry must re-send what was originally validated and sent — not
    // whatever the basket holds by the time the diner taps Retry.
    api.postPatch.and.returnValue(of() as any);   // response never arrives
    component.initiateOrder();
    const firstBody = api.postPatch.calls.mostRecent().args[1] as any;
    expect(firstBody.items[0].item).toBe('i1');

    // The diner edits while the outcome is unknown.
    basket.items = [line('i2', 7)];
    api.postPatch.calls.reset();
    api.postPatch.and.returnValue(of() as any);

    component.retryOrder();

    const replayBody = api.postPatch.calls.mostRecent().args[1] as any;
    expect(replayBody.client_order_id).toBe(firstBody.client_order_id);
    expect(replayBody.items).toEqual(firstBody.items);
  });

  // -- a retry is bound to what may actually be re-issued -----------------
  //
  // BOTH OF THESE ARE GATE C's CHANGE REACHING GATE B's PATH, and they are
  // here rather than in the durability spec because the failure is what the
  // COMPONENT does with a protected record. Making `isOutstanding`
  // stage-based (Gate C) widened what reaches `replayIssuedCommand`, and
  // classifying a replayable initiation by "it has items" let a record
  // `reserveIntent` had just refused issue a mutation anyway. Codex P2 ×2 on
  // PR #665; both valid.

  it('does not crash or re-send when an outstanding record lost its command',
     fakeAsync(() => {
    // A D04/D `submitting` record whose order id did not survive. It is
    // OUTSTANDING — an acceptance may have been issued — so it is protected
    // and the CTA offers Retry. But there is no order id to name, so the
    // retry must resolve nothing rather than dereference a handle that is
    // not there.
    storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY,
                    { key: 'k-lost', phase: 'submitting',
                      basket: basketService.contentIdentity(), context: ':',
                      startedAt: 1 });
    const stored = coordinator.read();
    expect(stored.kind).toBe('record');
    expect(stored.kind === 'record' && stored.record.command).toBeNull();
    expect(component.checkoutBlocked).toBeFalse();   // nothing recovered yet
    // The server can only say the acceptance did not land.
    api.get.and.returnValue(of(read({
      state: 'not_accepted', outcome: null, quote_ref: null,
      accepted_at: null,
    })) as any);
    api.postPatch.calls.reset();

    component.retryOrder();

    // RxJS REPORTS AN ERROR THROWN INSIDE A SUBSCRIBER ASYNCHRONOUSLY, so a
    // synchronous `not.toThrow()` around the call cannot see this one — it
    // escapes as an uncaught error that takes the whole runner down instead
    // of failing the spec. Draining the queue inside `fakeAsync` is what
    // makes it an assertion rather than a disconnect.
    expect(() => tick()).not.toThrow();
    expect(api.postPatch).not.toHaveBeenCalled();
    expect(coordinator.record()?.key).toBe('k-lost');
    expect(coordinator.record()?.command).toBeNull();
  }));

  it('tells the diner to check with staff rather than promising a retry that '
     + 'cannot fire', () => {
    storage.setItem(CheckoutCoordinatorService.ATTEMPT_KEY,
                    { key: 'k-lost', phase: 'submitting',
                      basket: basketService.contentIdentity(), context: ':',
                      startedAt: 1 });
    coordinator.read();
    api.get.and.returnValue(of(read({
      state: 'not_accepted', outcome: null, quote_ref: null,
      accepted_at: null,
    })) as any);

    component.retryOrder();

    const notice = component.recoveryNotice || '';
    expect(notice).not.toContain('Tap retry');
    expect(notice.toLowerCase()).toContain('check with staff');
  });

  it('does not re-initiate from a record this build cannot safely read',
     () => {
    // `isProtected` refuses to REPLACE this record at `reserveIntent`; a
    // retry must not issue a mutation from it either. A terminal `accepted`
    // claim with no outcome behind it is not a settled checkout, and its
    // stored lines are not a licence to send anything.
    storage.setItem(
      CheckoutCoordinatorService.ATTEMPT_KEY,
      {
        v: 2, key: 'k-partial', scope: ':',
        request: { identity: basketService.contentIdentity(),
                   canon: PURCHASE_CANON,
                   items: [{ item: 'i1', quantity: 1 }] },
        stage: 'accepted', command: null, outcome: null,
        startedAt: 1, protocol: 3, degraded: false,
      });
    expect(coordinator.read().kind).toBe('record');
    api.postPatch.calls.reset();

    component.retryOrder();

    const initiated = api.postPatch.calls.all()
      .filter((c) => c.args[0] === 'orders/initiate/');
    expect(initiated.length).toBe(0);
  });

  it('does not re-initiate from a record written under an unknown '
     + 'canonicalisation', () => {
    storage.setItem(
      CheckoutCoordinatorService.ATTEMPT_KEY,
      {
        v: 2, key: 'k-canon', scope: ':',
        request: { identity: basketService.contentIdentity(),
                   canon: 'some-future-canon-v9',
                   items: [{ item: 'i1', quantity: 1 }] },
        stage: 'pricing', command: null, outcome: null,
        startedAt: 1, protocol: 0, degraded: false,
      });
    expect(coordinator.read().kind).toBe('record');
    api.postPatch.calls.reset();

    component.retryOrder();

    const replayed = api.postPatch.calls.all().filter(
      (c) => (c.args[1] as any)?.client_order_id === 'k-canon');
    expect(replayed.length).toBe(0);
  });

  // -- messaging: a draft is not proof the request never arrived ----------

  it('does not tell the diner their order did not reach us on a draft', () => {
    // "Your order did not reach us" asserts non-execution. A draft
    // observation at one instant does not establish that; the honest
    // statement is that it is unconfirmed and retry re-sends the same
    // request.
    interrupted();
    api.get.and.returnValue(of(read({
      state: 'not_accepted', outcome: null, quote_ref: null,
      accepted_at: null,
    })) as any);

    fixture.detectChanges();

    expect(component.recoveryNotice).not.toContain('did not reach us');
  });
});
