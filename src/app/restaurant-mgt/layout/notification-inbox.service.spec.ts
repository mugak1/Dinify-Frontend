import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ConfirmDialogService } from '../../_common/confirm-dialog.service';
import { ErrorInterceptor, SILENT_FAILURE } from '../../_helpers/error.interceptor';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { ConnectivityService } from '../../_services/connectivity.service';
import { InactivityService } from '../../_services/inactivity.service';
import { ToastService } from '../../_shared/ui/toast/toast.service';
import {
  INBOX_POLL_MS, INBOX_TIMEOUT_MS, NotificationInboxService, UNREAD_COUNT_PATH,
} from './notification-inbox.service';

/**
 * SHELL-FINISH-00, PR 5 — the bell's unread count.
 *
 * Driven through the REAL ApiService, HttpClient and ErrorInterceptor, so "a
 * failed poll shows no toast" is a claim about the deployed chain, not about a
 * stub. Visibility is the browser's own `document.visibilityState`, overridden
 * per spec, and `visibilitychange` is dispatched on the real document.
 */
describe('NotificationInboxService (the bell\'s unread count)', () => {
  let svc: NotificationInboxService;
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  let visibility: DocumentVisibilityState;
  let auth: any;

  const isCount = (r: { url: string; method: string }) =>
    r.method === 'GET' && r.url.includes(UNREAD_COUNT_PATH);

  function pending(): TestRequest[] {
    return http.match(isCount);
  }

  function answer(req: TestRequest, count: number): void {
    req.flush({ status: 200, message: 'Unread count retrieved', data: { unread_count: count } });
  }

  function setVisibility(state: DocumentVisibilityState): void {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    visibility = 'visible';
    spyOnProperty(document, 'visibilityState', 'get').and.callFake(() => visibility);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info', 'clear', 'dismiss']);
    auth = {
      userValue: { token: 't', profile: { id: 'user-1' } },
      currentRestaurantRole: { restaurant_id: 'rest-a', restaurant: 'Bistro A', roles: ['manager'] },
      captureRequestOwner: () => null,
      ownerIsCurrent: () => true,
      logout: jasmine.createSpy('logout'),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: { url: '/dashboard' } },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    svc = TestBed.inject(NotificationInboxService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    svc.stop();
    http.verify();
  });

  it('asks for the selected restaurant\'s count, silently, as soon as it starts', fakeAsync(() => {
    svc.start();
    const [req] = pending();
    expect(req.request.url).toContain('restaurant=rest-a');
    expect(req.request.context.get(SILENT_FAILURE)).toBeTrue();
    answer(req, 4);
    expect(svc.unreadCount()).toBe(4);
    svc.stop();
    discardPeriodicTasks();
  }));

  it('polls every 60 seconds while the tab is visible', fakeAsync(() => {
    svc.start();
    answer(pending()[0], 1);
    tick(INBOX_POLL_MS - 1);
    expect(pending().length).toBe(0);
    tick(1);
    answer(pending()[0], 2);
    tick(INBOX_POLL_MS);
    answer(pending()[0], 3);
    expect(svc.unreadCount()).toBe(3);
    svc.stop();
    discardPeriodicTasks();
  }));

  describe('pauses while the tab is hidden and refreshes on return', () => {
    it('sends nothing while hidden, however long', fakeAsync(() => {
      svc.start();
      answer(pending()[0], 1);
      setVisibility('hidden');
      tick(INBOX_POLL_MS * 10);
      expect(pending().length).toBe(0);
      svc.stop();
    }));

    it('asks at once when the tab becomes visible, then resumes the 60s cadence', fakeAsync(() => {
      svc.start();
      answer(pending()[0], 1);
      setVisibility('hidden');
      tick(INBOX_POLL_MS * 3);
      setVisibility('visible');
      const [back] = pending();
      expect(back).toBeDefined();
      answer(back, 6);
      expect(svc.unreadCount()).toBe(6);
      tick(INBOX_POLL_MS);
      const resumed = pending();
      expect(resumed.length).toBe(1);
      answer(resumed[0], 6);
      svc.stop();
      discardPeriodicTasks();
    }));

    it('does not poll at all when it starts on a hidden tab, until it is shown', fakeAsync(() => {
      visibility = 'hidden';
      svc.start();
      tick(INBOX_POLL_MS * 2);
      expect(pending().length).toBe(0);
      setVisibility('visible');
      answer(pending()[0], 2);
      svc.stop();
      discardPeriodicTasks();
    }));
  });

  describe('a failed poll shows no toast and keeps the last count', () => {
    const failures: Array<[string, (r: TestRequest) => void]> = [
      ['the server is unreachable (status 0)', (r) => r.error(new ProgressEvent('error'), { status: 0, statusText: '' })],
      ['a 403 module denial', (r) => r.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' })],
      ['a 429', (r) => r.flush({ message: 'Slow down' }, { status: 429, statusText: 'Too Many Requests' })],
      ['a 500', (r) => r.flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' })],
      ['a 404 for the restaurant', (r) => r.flush({ status: 404, message: 'Not found' }, { status: 404, statusText: 'Not Found' })],
      ['an unreadable 200', (r) => r.flush({ status: 200, data: { unread_count: 'lots' } })],
      ['a negative count', (r) => r.flush({ status: 200, data: { unread_count: -1 } })],
    ];

    for (const [name, fail] of failures) {
      it(name, fakeAsync(() => {
        svc.start();
        answer(pending()[0], 5);
        tick(INBOX_POLL_MS);
        fail(pending()[0]);
        expect(svc.unreadCount()).toBe(5);
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.warning).not.toHaveBeenCalled();
        expect(toast.info).not.toHaveBeenCalled();
        svc.stop();
        discardPeriodicTasks();
      }));
    }

    it('CONTROL: the same failure without SILENT_FAILURE does toast (the interceptor is really in the chain)', () => {
      TestBed.inject(ApiService).get(null, UNREAD_COUNT_PATH, { restaurant: 'rest-a' })
        .subscribe({ error: () => undefined });
      http.expectOne(isCount).flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' });
      expect(toast.error).toHaveBeenCalledWith('Server error');
    });
  });

  describe('at most one request in flight, each bounded by a timeout', () => {
    it('a refresh asked for during a flight is not sent beside it, but once it settles', fakeAsync(() => {
      svc.start();
      const first = pending();
      expect(first.length).toBe(1);
      svc.refresh();
      svc.refresh();
      expect(pending().length).toBe(0);
      answer(first[0], 1);
      // One follow-up, however many refreshes were asked for during the flight.
      const followUp = pending();
      expect(followUp.length).toBe(1);
      answer(followUp[0], 2);
      expect(svc.unreadCount()).toBe(2);
      expect(pending().length).toBe(0);
      svc.stop();
      discardPeriodicTasks();
    }));

    it('the timeout is shorter than the poll interval, so a tick never meets a flight', () => {
      expect(INBOX_TIMEOUT_MS).toBeLessThan(INBOX_POLL_MS);
    });

    it('a request that takes longer than 10 seconds is abandoned and the count kept', fakeAsync(() => {
      svc.start();
      answer(pending()[0], 7);
      tick(INBOX_POLL_MS);
      const slow = pending()[0];
      tick(INBOX_TIMEOUT_MS);
      expect(slow.cancelled).toBeTrue();
      expect(svc.unreadCount()).toBe(7);
      expect(toast.error).not.toHaveBeenCalled();
      // The flight is free again: the next tick sends a fresh request.
      tick(INBOX_POLL_MS - INBOX_TIMEOUT_MS);
      answer(pending()[0], 8);
      expect(svc.unreadCount()).toBe(8);
      svc.stop();
      discardPeriodicTasks();
    }));

    it('requests made while the server is off cannot stack up', fakeAsync(() => {
      svc.start();
      // Ten minutes of a server that never answers, sampled every 5 seconds, with
      // refreshes asked for throughout: never more than one request outstanding.
      const seen: TestRequest[] = [];
      for (let t = 0; t < 10 * INBOX_POLL_MS; t += 5_000) {
        svc.refresh();
        tick(5_000);
        seen.push(...pending());
        expect(seen.filter((r) => !r.cancelled).length).toBeLessThanOrEqual(1);
      }
      // And it did keep asking: about one request per timeout window, never a pile.
      expect(seen.length).toBeGreaterThan(10);
      expect(svc.unreadCount()).toBeNull();
      svc.stop();
      discardPeriodicTasks();
    }));
  });

  it('stop() cancels the request in flight and polls no more', fakeAsync(() => {
    svc.start();
    const req = pending()[0];
    svc.stop();
    expect(req.cancelled).toBeTrue();
    tick(INBOX_POLL_MS * 3);
    setVisibility('visible');
    expect(pending().length).toBe(0);
  }));

  it('sends nothing without a selected restaurant', fakeAsync(() => {
    auth.currentRestaurantRole = null;
    svc.start();
    tick(INBOX_POLL_MS);
    expect(pending().length).toBe(0);
    expect(svc.unreadCount()).toBeNull();
    svc.stop();
    discardPeriodicTasks();
  }));

  it('setCount takes a count the caller already holds, and ignores one it cannot read', () => {
    svc.setCount(3);
    expect(svc.unreadCount()).toBe(3);
    svc.setCount('3');
    svc.setCount(2.5);
    svc.setCount(undefined);
    expect(svc.unreadCount()).toBe(3);
  });
});

/**
 * Polling never resets the idle-logout timer (amendment 8). The real
 * InactivityService runs beside the real poll for 13 minutes with no input, and
 * its warning still opens on time; then logout follows at 15.
 */
describe('NotificationInboxService and idle logout', () => {
  class FakeDialog {
    opened = 0;
    result = new Subject<unknown>();
    openModal() { this.opened++; return this.result; }
    closeModal() { /* no-op */ }
  }

  it('polling for 15 minutes with no input still lets idle logout run on time', fakeAsync(() => {
    const MINUTE = 60_000;
    const auth: any = {
      userValue: { token: 't', profile: { id: 'user-1' } },
      currentRestaurantRole: { restaurant_id: 'rest-a' },
      captureRequestOwner: () => null,
      ownerIsCurrent: () => true,
      logout: () => undefined,
      logoutDueToInactivity: jasmine.createSpy('logoutDueToInactivity'),
    };
    const dialog = new FakeDialog();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useValue: auth },
        { provide: ConfirmDialogService, useValue: dialog },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error', 'warning', 'info', 'success', 'clear']) },
        { provide: Router, useValue: { url: '/dashboard' } },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const inactivity = TestBed.inject(InactivityService);
    const inbox = TestBed.inject(NotificationInboxService);
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');

    inactivity.start();
    inbox.start();
    let polls = 0;
    const drain = () => http.match((r) => r.url.includes(UNREAD_COUNT_PATH)).forEach((r) => {
      polls++;
      r.flush({ status: 200, data: { unread_count: 1 } });
    });
    drain();
    for (let m = 1; m <= 13; m++) {
      tick(MINUTE);
      drain();
    }
    expect(polls).toBe(14);
    expect(dialog.opened).toBe(1);
    expect(auth.logoutDueToInactivity).not.toHaveBeenCalled();
    for (let m = 14; m <= 15; m++) {
      tick(MINUTE);
      drain();
    }
    expect(polls).toBe(16);
    expect(auth.logoutDueToInactivity).toHaveBeenCalledTimes(1);

    inbox.stop();
    inactivity.stop();
    http.verify();
    discardPeriodicTasks();
  }));
});
