/**
 * Step 2 (diner round state v1) — THE CONFIRMATION SCREEN SAYS WHAT IS TRUE.
 *
 * At a pay-after restaurant a diner's first round can be HELD until staff
 * confirm it on the floor view, and the kitchen does not see it until then.
 * This screen said "Order placed — Sent to the kitchen" for every order and
 * never looked again. It now renders the state the server stated:
 *
 *   held      "Waiting for staff"   (stale: "Still waiting…")
 *   declined  "Order not accepted"
 *   released  today's screen, unchanged
 *
 * and re-reads a held round through the diner's OWN order read
 * (`orders/journey/order-details/?intent=<the order's key>`).
 *
 * AGAINST TODAY'S BACKEND NOTHING CHANGES. The first block proves it with a
 * fingerprint of the rendered markup taken on unmodified `main` (0796844),
 * before either template was edited: every element, attribute, class, text
 * node and SVG path is compared, normalised only for Angular's comment anchors
 * and generated attributes (see `markup-fingerprint.testing.ts`). If the
 * released screen is ever changed DELIBERATELY, re-take the fingerprint in the
 * same change and say so.
 *
 * Driven through the real component, the real `ApiService`, `HttpClient`, the
 * `DinerSessionInterceptor` and the `ErrorInterceptor`, with the reads answered
 * by `HttpTestingController`. Navigation state is supplied through
 * `history.state`, which is exactly the path a RELOAD of this screen takes
 * (there is no current navigation then).
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { WINDOW } from 'src/app/_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from 'src/app/_services/storage/storage-key-prefix.token';
import { DinerSessionService } from 'src/app/_services/diner-session.service';
import { DinerSessionInterceptor } from 'src/app/_helpers/diner-session.interceptor';
import { ErrorInterceptor } from 'src/app/_helpers/error.interceptor';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { ConnectivityService } from 'src/app/_services/connectivity.service';
import { CREDENTIAL_HEADER, SESSION_HEADER } from 'src/app/_security/diner-capability-contract';
import { readDinerRound } from 'src/app/_shared/order/checkout-correlation';
import { OrderCompleteComponent } from './order-complete.component';
import { fingerprint, normalizedMarkup } from './markup-fingerprint.testing';

/** Rendered-markup fingerprints of THIS screen on unmodified main (0796844). */
const MAIN_FULL = '40867e79';
const MAIN_EMPTY = 'b615d107';

const FULL = {
  tableNumber: 4, tableId: 't1', orderId: 'o1', orderNumber: 7,
  socials: { instagram: 'dinify' },
};
const KEY = 'K1';
const HELD = { state: 'held', held_since: '2026-11-05T12:01:09+03:00', stale: false };
const DECLINED = { state: 'declined', held_since: null, stale: false };
const RELEASED = { state: 'released', held_since: null, stale: false };

/** The diner's own order read, as the backend answers it at level 3. `round`
 *  undefined means the key is absent (today's backend). */
function orderRead(round: unknown, over: Record<string, unknown> = {}) {
  const current: Record<string, unknown> = {
    order_status: 'pending', fulfilment_status: 'new',
    cancelled_at: null, served_at: null,
  };
  if (round !== undefined) current['round'] = round;
  return {
    status: 200,
    data: {
      checkout: {
        order_id: 'o1', intent_key: KEY,
        scope: { restaurant: 'r1', table: 't1' },
        acceptance: {
          state: 'accepted', outcome: null, quote_ref: 'q1',
          accepted_at: '2026-11-05T09:01:09+00:00',
        },
        current, checkout_protocol: 3, ...over,
      },
    },
  };
}

describe('OrderCompleteComponent — Step 2 round state', () => {
  let fixture: ComponentFixture<OrderCompleteComponent>;
  let component: OrderCompleteComponent;
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  let hidden = false;

  beforeEach(async () => {
    hidden = false;
    spyOnProperty(document, 'hidden', 'get').and.callFake(() => hidden);
    toast = jasmine.createSpyObj<ToastService>(
      'ToastService', ['success', 'error', 'info', 'warning', 'clear', 'dismiss']);
    await TestBed.configureTestingModule({
      declarations: [OrderCompleteComponent],
      providers: [
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: DinerSessionInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: ToastService, useValue: toast },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    // The diner's table session, which checkout deliberately keeps.
    TestBed.inject(DinerSessionService).setToken('SESS');
  });

  afterEach(() => {
    fixture?.destroy();
    http.verify();
    history.replaceState(null, '');
    window.sessionStorage.clear();
  });

  function create(state: Record<string, unknown>): void {
    history.replaceState(state, '');
    fixture = TestBed.createComponent(OrderCompleteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const markup = () => fingerprint(normalizedMarkup(root()));
  const heading = () => root().querySelector('h1')?.textContent?.trim();
  const reviewCard = () => text().includes('How was it?');
  const submitButton = () => Array.from(root().querySelectorAll('button'))
    .some(b => /Rate to submit|Submit review/.test(b.textContent ?? ''));
  const pending = () => http.match(r => r.url.includes('orders/journey/order-details/'));
  const expectRead = (): TestRequest => http.expectOne(
    r => r.urlWithParams.includes(`orders/journey/order-details/?intent=${KEY}`));
  /** Leave the screen (destroys it, cancelling the next scheduled read), so a
   *  test that ends while the round is still held leaves no timer behind. */
  const leave = () => fixture.destroy();
  const noKitchen = () =>
    expect(root().innerHTML.toLowerCase()).withContext('the word "kitchen"').not.toContain('kitchen');

  // ── 1. today's backend: byte-for-byte as main ──────────────────────────────

  describe('against today\'s reply shape (no round)', () => {
    it('renders the full screen byte-for-byte as main', () => {
      create({ ...FULL });
      expect(markup()).toBe(MAIN_FULL);
      expect(heading()).toBe('Order placed');
      expect(text()).toContain("Sent to the kitchen. We'll bring it over shortly.");
      expect(reviewCard()).toBeTrue();
    });

    it('renders the bare screen (nothing forwarded) byte-for-byte as main', () => {
      create({});
      expect(markup()).toBe(MAIN_EMPTY);
    });

    it('is still byte-for-byte when the new key is forwarded but the round is not', () => {
      create({ ...FULL, round: null, intentKey: KEY });
      expect(markup()).toBe(MAIN_FULL);
    });

    it('a stated RELEASED round is today\'s screen too', () => {
      create({ ...FULL, round: RELEASED, intentKey: KEY });
      expect(markup()).toBe(MAIN_FULL);
    });

    it('reads nothing: no round, no re-read', fakeAsync(() => {
      create({ ...FULL, intentKey: KEY });
      tick(120_000);
      expect(pending().length).toBe(0);
    }));

    it('does not touch the route title', () => {
      const title = TestBed.inject(Title);
      title.setTitle('Order placed');
      create({ ...FULL });
      expect(title.getTitle()).toBe('Order placed');
    });
  });

  describe('a malformed round is treated as absent', () => {
    const malformed: [string, unknown][] = [
      ['an unknown state', { state: 'pending', held_since: null, stale: false }],
      ['a differently-cased state', { state: 'HELD', stale: false }],
      ['no state', { held_since: '2026-11-05T12:01:09+03:00', stale: true }],
      ['a string', 'held'],
      ['an array', ['held']],
      ['a number', 1],
      ['true', true],
    ];
    for (const [label, round] of malformed) {
      it(`${label} renders today's screen and starts no re-read`, fakeAsync(() => {
        create({ ...FULL, round, intentKey: KEY });
        expect(markup()).toBe(MAIN_FULL);
        tick(30_000);
        expect(pending().length).toBe(0);
      }));
    }
  });

  // ── 2. each state renders its copy ─────────────────────────────────────────

  describe('copy', () => {
    it('held: "Waiting for staff", no review card, no kitchen', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      expect(heading()).toBe('Waiting for staff');
      expect(text()).toContain('Waiting for staff to confirm your order.');
      expect(text()).not.toContain('Order placed');
      expect(reviewCard()).toBeFalse();
      expect(submitButton()).toBeFalse();
      // The order card and the way back are unchanged.
      expect(text()).toContain('#007');
      expect(text()).toContain('Back to menu');
      noKitchen();
      expect(TestBed.inject(Title).getTitle()).toBe('Waiting for staff');
      leave();
    }));

    it('held and stale (the server\'s flag): "Still waiting…"', fakeAsync(() => {
      create({ ...FULL, round: { ...HELD, stale: true }, intentKey: KEY });
      expect(heading()).toBe('Waiting for staff');
      expect(text()).toContain('Still waiting. Please ask a member of staff.');
      expect(text()).not.toContain('Waiting for staff to confirm your order.');
      expect(reviewCard()).toBeFalse();
      noKitchen();
      leave();
    }));

    it('declined: "Order not accepted", no review card, no kitchen', fakeAsync(() => {
      create({ ...FULL, round: DECLINED, intentKey: KEY });
      expect(heading()).toBe('Order not accepted');
      expect(text()).toContain("This order wasn't accepted. Please ask a member of staff.");
      expect(reviewCard()).toBeFalse();
      expect(submitButton()).toBeFalse();
      noKitchen();
      expect(TestBed.inject(Title).getTitle()).toBe('Order not accepted');
      tick(60_000);
      expect(pending().length).toBe(0);   // a declined round is never re-read
    }));

    it('held with nothing else forwarded still never mentions the kitchen', fakeAsync(() => {
      create({ round: HELD });
      expect(heading()).toBe('Waiting for staff');
      noKitchen();
    }));

    it('a review cannot be submitted while held, even called directly', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      component.overall.set(5);
      component.submitReview();
      expect(http.match(r => r.url.includes('reviews/submit/')).length).toBe(0);
      leave();
    }));
  });

  // ── 3. stale is the server's flag only ─────────────────────────────────────

  describe('stale comes from the server only, never from a clock', () => {
    afterEach(() => jasmine.clock().uninstall());

    it('a round held for hours with stale:false is NOT shown as stale', fakeAsync(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date('2026-11-05T18:00:00+03:00'));   // 6 h later
      create({ ...FULL, round: HELD, intentKey: KEY });
      expect(text()).toContain('Waiting for staff to confirm your order.');
      expect(text()).not.toContain('Still waiting');
      leave();
    }));

    it('a round held a moment ago with stale:true IS shown as stale', fakeAsync(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date('2026-11-05T12:01:10+03:00'));   // 1 s later
      create({ ...FULL, round: { ...HELD, stale: true }, intentKey: KEY });
      expect(text()).toContain('Still waiting. Please ask a member of staff.');
      leave();
    }));

    it('a non-boolean stale is "not given"', () => {
      create({ ...FULL, round: { ...HELD, stale: 'true' }, intentKey: KEY });
      expect(text()).toContain('Waiting for staff to confirm your order.');
    });

    it('the reader keeps a naive held_since as not given, and the round as held', () => {
      expect(readDinerRound({ ...HELD, held_since: '2026-11-05T12:01:09' }))
        .toEqual({ state: 'held', heldSince: null, stale: false });
    });
  });

  // ── 4. transitions, through the real order read ────────────────────────────

  describe('re-reading a held round', () => {
    it('reads every 10 s, through the existing route with only the session header', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(9_999);
      expect(pending().length).toBe(0);
      tick(1);
      const req = expectRead();
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get(SESSION_HEADER)).toBe('SESS');
      expect(req.request.headers.has(CREDENTIAL_HEADER)).toBeFalse();
      expect(req.request.body).toBeNull();
      req.flush(orderRead(HELD));
      tick(10_000);
      expectRead().flush(orderRead(HELD));
      leave();
    }));

    it('held → released: today\'s copy and the review card appear, and reading stops', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush(orderRead(RELEASED));
      fixture.detectChanges();
      expect(heading()).toBe('Order placed');
      expect(text()).toContain("Sent to the kitchen. We'll bring it over shortly.");
      expect(reviewCard()).toBeTrue();
      expect(submitButton()).toBeTrue();
      expect(markup()).toBe(MAIN_FULL);
      expect(TestBed.inject(Title).getTitle()).toBe('Order placed');
      tick(300_000);
      expect(pending().length).toBe(0);
    }));

    it('held → (read with no round key) is released, per the contract', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush(orderRead(undefined));
      fixture.detectChanges();
      expect(heading()).toBe('Order placed');
      tick(60_000);
      expect(pending().length).toBe(0);
    }));

    it('held → declined: the declined copy, no review card, and reading stops', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush(orderRead(DECLINED, {}));
      fixture.detectChanges();
      expect(heading()).toBe('Order not accepted');
      expect(reviewCard()).toBeFalse();
      noKitchen();
      tick(300_000);
      expect(pending().length).toBe(0);
    }));

    it('held → held and stale: the stale copy, still reading', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush(orderRead({ ...HELD, stale: true }));
      fixture.detectChanges();
      expect(text()).toContain('Still waiting. Please ask a member of staff.');
      noKitchen();
      tick(10_000);
      expectRead().flush(orderRead(RELEASED));
    }));

    it('backs off on failure (10 → 20 → 40 → 60 → 60 s) and resets on success', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });
      for (const wait of [20_000, 40_000, 60_000, 60_000]) {
        tick(wait - 1);
        expect(pending().length).withContext(`before ${wait}`).toBe(0);
        tick(1);
        expectRead().flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });
      }
      tick(60_000);
      expectRead().flush(orderRead(HELD));      // success resets the delay
      tick(10_000);
      expectRead().flush(orderRead(HELD));
      // A failed background read is not the diner's business: no toast, and
      // the held screen is kept rather than guessed at.
      expect(toast.error).not.toHaveBeenCalled();
      fixture.detectChanges();
      expect(heading()).toBe('Waiting for staff');
      leave();
    }));

    it('a rate-limited read (429) raises no toast and backs off (Codex P2 on #801)', fakeAsync(() => {
      // The interceptor's 429 branch runs BEFORE its `intent=` carve-out, so
      // without SILENT_FAILURE an unattended held screen would tell the diner
      // "too many attempts" on every retry of a read they never asked for.
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush({ message: 'slow down' }, { status: 429, statusText: 'Too Many Requests' });
      tick(20_000);
      expectRead().flush({ message: 'slow down' }, { status: 429, statusText: 'Too Many Requests' });
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      tick(39_999);
      expect(pending().length).toBe(0);   // still backing off: 40 s after two failures
      tick(1);
      expectRead().flush(orderRead(RELEASED));
    }));

    it('a read that never answers counts as a failure after 10 s', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      const first = expectRead();
      tick(10_000);                       // timed out (the request is cancelled)
      expect(first.cancelled).toBeTrue();
      tick(19_999);
      expect(pending().length).toBe(0);
      tick(1);
      expectRead().flush(orderRead(RELEASED));
    }));

    it('an answer about another order, or no readable projection, changes nothing and backs off',
      fakeAsync(() => {
        create({ ...FULL, round: HELD, intentKey: KEY });
        tick(10_000);
        expectRead().flush(orderRead(RELEASED, { intent_key: 'OTHER' }));
        fixture.detectChanges();
        expect(heading()).toBe('Waiting for staff');
        tick(20_000);
        expectRead().flush(orderRead(RELEASED, { order_id: 'o2' }));
        fixture.detectChanges();
        expect(heading()).toBe('Waiting for staff');
        tick(40_000);
        expectRead().flush({ status: 200, data: { id: 'o1', accepted: true } });
        fixture.detectChanges();
        expect(heading()).toBe('Waiting for staff');
        tick(60_000);
        expectRead().flush(orderRead(RELEASED));
      }));

    it('a malformed round in a read is absent, i.e. released', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      expectRead().flush(orderRead({ state: 'mystery' }));
      fixture.detectChanges();
      expect(heading()).toBe('Order placed');
      tick(60_000);
      expect(pending().length).toBe(0);
    }));

    it('pauses while the tab is hidden and reads at once when it is shown', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(5_000);
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      tick(120_000);
      expect(pending().length).toBe(0);
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      expectRead().flush(orderRead(HELD));
      tick(10_000);
      expectRead().flush(orderRead(RELEASED));
    }));

    it('opened while hidden, it reads nothing until shown', fakeAsync(() => {
      hidden = true;
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(60_000);
      expect(pending().length).toBe(0);
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      expectRead().flush(orderRead(RELEASED));
    }));

    it('stops when the screen is left', fakeAsync(() => {
      create({ ...FULL, round: HELD, intentKey: KEY });
      tick(10_000);
      const inFlight = expectRead();
      fixture.destroy();
      expect(inFlight.cancelled).toBeTrue();
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      tick(300_000);
      expect(pending().length).toBe(0);
    }));

    it('with no key forwarded it shows the held copy and reads nothing', fakeAsync(() => {
      create({ ...FULL, round: HELD });
      expect(heading()).toBe('Waiting for staff');
      tick(120_000);
      expect(pending().length).toBe(0);
    }));
  });
});
