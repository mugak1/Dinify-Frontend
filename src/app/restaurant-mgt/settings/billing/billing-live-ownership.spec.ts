import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import {
  HTTP_INTERCEPTORS,
  provideHttpClient,
  withInterceptorsFromDi,
  withXhr,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  TestRequest,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { AuthInterceptor } from 'src/app/_helpers/auth.interceptor';
import { ErrorInterceptor } from 'src/app/_helpers/error.interceptor';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { BillingComponent } from './billing.component';

/**
 * D07/B1 — A BILLING READ IS OWNED BY THE LIVE CONTEXT, NOT BY THE LAST SNAPSHOT
 * `reload()` HAPPENED TO INSTALL.
 *
 * G2 gave every in-flight read an immutable owner — principal, restaurant,
 * generation — captured before the request. That much was right and is kept.
 * What it compared that owner against was the WRONG THING: `this.scope`, a
 * field only `reload()` ever writes. So the guard could only ever see a
 * transition this component had itself been told about.
 *
 * MEASURED ON THE UNMODIFIED COMPONENT, through this file:
 *
 *   auth restaurant changes, no component reload   ->  owns() === true
 *   auth principal changes, no component reload    ->  owns() === true
 *   component destroyed with both reads in flight  ->  owns() === true
 *
 * All three repaint, and the third writes to a destroyed instance. The shape
 * of the fix is the one D04 settled for the diner checkout and the one the
 * kitchen board settled for its own scope: THE OWNER STAYS FROZEN AND WHAT IT
 * IS MEASURED AGAINST IS READ LIVE. Replacing the captured owner with the
 * current principal would be the opposite error — attributing an old answer to
 * a new user.
 *
 * WHAT THE PRODUCT ACTUALLY DOES, stated rather than implied, because the
 * label decides how much these tests are worth:
 *
 *   PRINCIPAL — really published, really in-session. `AuthenticationService`
 *     pushes `userSubject` on profile update, on OTP completion, on a token
 *     refresh and (as `null`) on logout. Observing it is the mechanism the
 *     kitchen board already uses (`kitchen-order.service.ts`), so this is the
 *     repository's established answer rather than a new one.
 *   RESTAURANT — `rest_role` is written by `login.component` and by
 *     `installAuthenticatedSessionAndReload`, and EVERY one of those writers
 *     ends in a full document load. No shipped in-app switch keeps this
 *     component mounted across a restaurant change, so the restaurant half of
 *     the guard is DEFENSIVE: what is promised is that nothing ACTS on a stale
 *     context, exactly as the kitchen board records for itself. This file
 *     constructs that interleaving rather than reaching it, and says so.
 *   DESTRUCTION — ordinary. Routing away from Settings > Billing with either
 *     read outstanding is the common case, and Angular does not cancel an HTTP
 *     request when a component is destroyed; only unsubscribing does.
 *
 * WHAT A DEPARTED SCOPE DOES, and why it is a re-read rather than a banner:
 * `reload()` is the one transition. It already clears the previous scope's
 * content at once, bumps the generation so everything in flight is disowned,
 * and re-reads for whatever is current — and it sends NOTHING when there is
 * nothing to read, which is the sign-out case (storage is cleared before the
 * principal is published). Painting an error instead would report a failure
 * that did not happen, on a screen that is usually one frame from a hard
 * redirect.
 *
 * DESTRUCTION IS ASSERTED THROUGH THE TESTING CLIENT'S OWN REPORT —
 * `TestRequest.cancelled` and `verify({ignoreCancelled: true})`. A cancelled
 * request is never flushed here: delivering a response to a subscription that
 * has already gone away is not a state the deployed app can reach, so
 * asserting on it would prove nothing.
 *
 * FOUR HALVES, FOUR DISTINCT PINS — measured by reverting each one alone, with
 * every other spec in this file holding:
 *
 *   owns() back to the `this.scope` snapshot  ->  the restaurant regression
 *   the reads unbound from `destroy$`         ->  destruction CANCELS both reads
 *   the principal no longer observed          ->  departed content cleared at once
 *   `reload()`'s destroyed guard removed      ->  no replacement request
 *
 * Worth knowing before trusting that: with the observation in place, a PUBLISHED
 * principal change is refused TWICE — the live-context comparison catches it, and
 * so does the generation, because the observation re-reads. The restaurant half
 * has no such second line (nothing publishes it), which is why it is the spec the
 * first mutation fails. The `!this.destroyed` clause inside `owns()` is likewise
 * belt and braces once the reads are cancelled, and is labelled as such where it
 * is written rather than presented as load-bearing.
 *
 * THE PRODUCTION INTERCEPTOR CHAIN IS REGISTERED HERE, and a control proves it
 * ran: G2's suite configured a real `HttpClient` without `AuthInterceptor` or
 * `ErrorInterceptor`, which is not the same thing as the deployed stack. The
 * discriminating assertions are the `Authorization` header one interceptor adds
 * and the string an ordinary failure is flattened to by the other.
 */
describe('D07/B1 — billing reads are owned by the live context', () => {
  let component: BillingComponent;
  let fixture: ComponentFixture<BillingComponent>;
  let http: HttpTestingController;

  /** The published principal. A REAL subject: the component is expected to observe it. */
  let published: BehaviorSubject<any>;

  const TERMS = {
    recurring_amount: '150000.00',
    currency: 'UGX',
    billing_interval: { unit: 'month', count: 1 },
    effective_from: '2026-07-01T00:00:00+03:00',
  };
  const RECORDED = { subscription_terms: { recorded: true, current: TERMS } };

  let authStub: any;

  beforeEach(async () => {
    published = new BehaviorSubject<any>({ profile: { id: 'user-1' }, token: 'tkn-1' });
    authStub = {
      user: published.asObservable(),
      userValue: { profile: { id: 'user-1' }, token: 'tkn-1' },
      currentRestaurantRole: { restaurant_id: 'rest-1' },
      currentRestaurant: { id: 'rest-1' },
    };

    await TestBed.configureTestingModule({
      declarations: [BillingComponent],
      providers: [
        // The DEPLOYED wiring (see `app.module.ts`), not merely a real HttpClient.
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        { provide: AuthenticationService, useValue: authStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BillingComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  const subReqs = () =>
    http.match((r) => r.url.includes('restaurant-setup/subscription-details/'));
  const listReqs = () =>
    http.match((r) => r.url.includes('reports/restaurant/transactions-listing/'));

  /** Both reads, still outstanding. Nothing is answered. */
  function open(): { sub: TestRequest; list: TestRequest } {
    fixture.detectChanges();
    const s = subReqs();
    const l = listReqs();
    expect(s.length).toBe(1);
    expect(l.length).toBe(1);
    return { sub: s[0], list: l[0] };
  }

  const el = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  /** Publish a principal change the way `AuthenticationService` does. */
  function switchPrincipal(id: string): void {
    authStub.userValue = { profile: { id }, token: 'tkn-1' };
    published.next(authStub.userValue);
  }

  /** Move the selected membership. `rest_role` publishes nothing; this mirrors that. */
  function switchRestaurant(id: string): void {
    authStub.currentRestaurantRole = { restaurant_id: id };
    authStub.currentRestaurant = { id };
  }

  /** Answer whatever is still outstanding, so `verify()` has nothing to report. */
  function drain(): void {
    for (const r of subReqs()) if (!r.cancelled) r.flush({ status: 200, data: {} });
    for (const r of listReqs()) if (!r.cancelled) r.flush({ status: 200, data: [] });
  }

  // ── the production chain really is the one under test ─────────────────────

  describe('CONTROL: the deployed interceptor chain is what these tests drive', () => {
    it('AuthInterceptor ran — the read carries the principal\'s bearer token', () => {
      const { sub, list } = open();
      expect(sub.request.headers.get('Authorization')).toBe('Bearer tkn-1');
      expect(list.request.headers.get('Authorization')).toBe('Bearer tkn-1');
      drain();
    });

    it('ErrorInterceptor ran — an ordinary failure reaches the subscriber FLATTENED to a string', () => {
      // The interceptor collapses a generic failure to `err.error?.message`, a
      // STRING with no status. A raw `HttpErrorResponse` here would mean the
      // chain was not installed and every claim about it would be untested,
      // so this is the assertion that discriminates rather than the component's
      // own error state, which would read 'error' either way.
      const api = TestBed.inject(ApiService);
      let received: unknown = 'not-called';
      api
        .get<any>(null, 'restaurant-setup/subscription-details/', { restaurant: 'rest-1' })
        .subscribe({ next: () => undefined, error: (e: unknown) => { received = e; } });

      subReqs()[0].flush(
        { status: 500, message: 'flattened by the interceptor' },
        { status: 500, statusText: 'Server Error' },
      );

      expect(typeof received).toBe('string');
      expect(received).toBe('flattened by the interceptor');
    });
  });

  // ── B1: the regressions ───────────────────────────────────────────────────

  describe('a context this component was never told about still refuses an answer', () => {
    it('THE REGRESSION: a principal change WITHOUT reload() does not repaint', () => {
      const { sub, list } = open();

      // NOT `component.reload()`. The transition is published on the service,
      // which is the only thing a real principal change does here.
      switchPrincipal('user-2');

      // user-1's answer lands after user-2 is in force.
      if (!sub.cancelled) sub.flush({ status: 200, data: RECORDED });
      if (!list.cancelled) list.flush({ status: 200, data: [] });
      fixture.detectChanges();

      expect(component.terms).toBeNull();
      expect(el('terms-amount')).toBeNull();
      drain();
    });

    it('THE REGRESSION: a restaurant change WITHOUT reload() does not repaint', () => {
      const { sub, list } = open();

      switchRestaurant('rest-2');

      if (!sub.cancelled) sub.flush({ status: 200, data: RECORDED });
      if (!list.cancelled) list.flush({ status: 200, data: [{ id: 1, amount: '1.00' }] });
      fixture.detectChanges();

      expect(component.terms).toBeNull();
      expect(component.transaction_list.length).toBe(0);
      expect(el('terms-amount')).toBeNull();
      drain();
    });

    it('THE REGRESSION: a late FAILURE for a departed scope does not report the screen broken', () => {
      // The worse direction of the same defect: an older error overwriting a
      // newer state reports a working screen as broken.
      const { sub, list } = open();
      switchPrincipal('user-2');

      if (!sub.cancelled) {
        sub.flush({ status: 500, message: 'nope' }, { status: 500, statusText: 'Server Error' });
      }
      if (!list.cancelled) {
        list.flush({ status: 500, message: 'nope' }, { status: 500, statusText: 'Server Error' });
      }
      fixture.detectChanges();

      expect(component.loadState).not.toBe('error');
      expect(component.historyState).not.toBe('failed');
      drain();
    });

    it('THE REGRESSION: content read for a departed scope is cleared at once, not when another answer arrives', () => {
      const { sub, list } = open();
      sub.flush({ status: 200, data: RECORDED });
      list.flush({ status: 200, data: [{ id: 1, amount: '1.00' }] });
      fixture.detectChanges();
      // Premise: it really is on screen for user-1.
      expect(el('terms-amount')).not.toBeNull();
      expect(component.transaction_list.length).toBe(1);

      switchPrincipal('user-2');
      fixture.detectChanges();

      // No second answer has arrived and none is required: user-1's price must
      // not still be under user-2's heading while one is awaited.
      expect(component.terms).toBeNull();
      expect(component.transaction_list.length).toBe(0);
      expect(el('terms-amount')).toBeNull();
      drain();
    });
  });

  describe('a destroyed instance owns nothing', () => {
    it('THE REGRESSION: destruction CANCELS both outstanding reads', () => {
      const { sub, list } = open();

      fixture.destroy();

      // Angular does not cancel an HTTP request when a component is destroyed;
      // only unsubscribing does. This is the testing client's own report.
      expect(sub.cancelled).toBe(true);
      expect(list.cancelled).toBe(true);
      http.verify({ ignoreCancelled: true });
    });

    it('THE REGRESSION: no state is written for a destroyed instance', () => {
      const { sub, list } = open();
      const before = {
        load: component.loadState,
        history: component.historyState,
        details: component.details,
      };

      fixture.destroy();
      // Belt and braces: even a callback that somehow still ran must write nothing.
      if (!sub.cancelled) sub.flush({ status: 200, data: RECORDED });
      if (!list.cancelled) list.flush({ status: 200, data: [{ id: 1, amount: '1.00' }] });

      expect(component.loadState).toBe(before.load);
      expect(component.historyState).toBe(before.history);
      expect(component.details).toBe(before.details);
      expect(component.terms).toBeNull();
      http.verify({ ignoreCancelled: true });
    });

    it('THE REGRESSION: a destroyed instance sends no replacement request', () => {
      open();
      fixture.destroy();
      http.verify({ ignoreCancelled: true });

      component.reload();

      expect(subReqs().length).toBe(0);
      expect(listReqs().length).toBe(0);
      http.verify({ ignoreCancelled: true });
    });

    it('CONTROL: a NEW instance may still perform its own authorized reads', () => {
      open();
      fixture.destroy();
      http.verify({ ignoreCancelled: true });

      const next = TestBed.createComponent(BillingComponent);
      next.detectChanges();
      expect(subReqs().length).toBe(1);
      expect(listReqs().length).toBe(1);
      drain();
      next.destroy();
    });
  });

  // ── the controls the fix must not break ───────────────────────────────────

  describe('CONTROLS: ordinary behaviour is unchanged', () => {
    it('an answer for the CURRENT scope still lands', () => {
      const { sub, list } = open();
      sub.flush({ status: 200, data: RECORDED });
      list.flush({ status: 200, data: [{ id: 1, amount: '1.00' }] });
      fixture.detectChanges();

      expect(component.terms?.recurring_amount).toBe('150000.00');
      expect(component.loadState).toBe('ready');
      expect(component.historyState).toBe('ready');
      expect(el('terms-amount')).not.toBeNull();
    });

    it('an ordinary same-scope reload still supersedes the older in-flight answer', () => {
      const first = open();

      component.reload();
      // `match()` REMOVES what it matches, so `open()` already took the first
      // pair out of the pending queue; what is left here is the retry's pair.
      const secondSub = subReqs();
      const secondList = listReqs();
      expect(secondSub.length).toBe(1);
      expect(secondList.length).toBe(1);

      // The older pair — still a live TestRequest — must lose to the newer one.
      first.sub.flush({ status: 200, data: RECORDED });
      first.list.flush({ status: 200, data: [{ id: 9, amount: '9.00' }] });
      fixture.detectChanges();
      expect(component.terms).toBeNull();
      expect(component.transaction_list.length).toBe(0);

      secondSub[0].flush({ status: 200, data: { subscription_terms: { recorded: false, current: null } } });
      secondList[0].flush({ status: 200, data: [] });
      fixture.detectChanges();
      expect(component.termsAbsent).toBe(true);
    });

    it('CONTROL: a TOKEN REFRESH republishes the SAME principal and discards nothing', () => {
      // `attemptTokenRefresh` pushes a new object with new tokens and the same
      // profile. Treating every emission as a context change would break an
      // ordinary billing read on every refresh, which is the opposite defect.
      const { sub, list } = open();

      authStub.userValue = { profile: { id: 'user-1' }, token: 'tkn-2' };
      published.next(authStub.userValue);

      if (!sub.cancelled) sub.flush({ status: 200, data: RECORDED });
      if (!list.cancelled) list.flush({ status: 200, data: [{ id: 1, amount: '1.00' }] });
      fixture.detectChanges();

      expect(component.terms?.recurring_amount).toBe('150000.00');
      expect(component.transaction_list.length).toBe(1);
      expect(el('terms-amount')).not.toBeNull();
    });

    it('CONTROL: the two sections still fail independently', () => {
      const { sub, list } = open();
      sub.flush({ status: 200, data: RECORDED });
      list.flush({ status: 500, message: 'nope' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(component.loadState).toBe('ready');
      expect(component.terms?.recurring_amount).toBe('150000.00');
      expect(component.historyState).toBe('failed');
    });

    it('CONTROL: the read-only retry still re-runs BOTH reads', () => {
      const { sub, list } = open();
      sub.flush({ status: 500, message: 'nope' }, { status: 500, statusText: 'Server Error' });
      list.flush({ status: 500, message: 'nope' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(component.loadState).toBe('error');

      component.reload();
      const again = { sub: subReqs(), list: listReqs() };
      expect(again.sub.length).toBe(1);
      expect(again.list.length).toBe(1);
      again.sub[0].flush({ status: 200, data: {} });
      again.list[0].flush({ status: 200, data: [] });
    });
  });
});
