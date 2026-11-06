import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { ErrorInterceptor } from 'src/app/_helpers/error.interceptor';
import { InboxNotification } from 'src/app/_models/app.models';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ConnectivityService } from 'src/app/_services/connectivity.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { BadgeComponent } from 'src/app/_shared/ui/badge/badge.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { CardComponent } from 'src/app/_shared/ui/card/card.component';
import { PageHeaderComponent } from 'src/app/_shared/ui/page-header/page-header.component';
import { NotificationInboxService, UNREAD_COUNT_PATH } from '../layout/notification-inbox.service';
import { INBOX_PATH, RestNotificationsComponent, readOnePath } from './rest-notifications.component';
import { FLOOR_SERVICE_LINK, describeNotification, readInboxPage } from './inbox-notification';

/**
 * Step 2, FE-E — the bell's words for `round_waiting` (BE-G).
 *
 * One row per restaurant, re-alerting when a new round starts waiting, with the
 * payload `{waiting, oldest_held_since, latest_table}`. The wording follows
 * `waiting`; a `waiting` this client cannot read gets neutral words and the link,
 * never a guessed count.
 */
describe('round_waiting — the words (describeNotification)', () => {
  const base: InboxNotification = {
    id: 'w1', kind: 'round_waiting', module: 'tables',
    occurred_at: '2026-11-06T12:00:00+03:00', read: false, payload: {}, actor_name: null,
  };
  const words = (payload: Record<string, unknown>) => describeNotification({ ...base, payload });

  it('1 waiting: singular title, singular detail, the floor link and the waiting icon', () => {
    const v = words({ waiting: 1, oldest_held_since: '2026-11-06T11:55:00+03:00', latest_table: null });
    expect(v.title).toBe('1 order waiting for staff');
    expect(v.detail).toBe('Confirm it on the floor view.');
    expect(v.link).toEqual(FLOOR_SERVICE_LINK);
    expect(v.icon).toBe('waiting');
  });

  it('several waiting: plural title and detail', () => {
    const v = words({ waiting: 3, oldest_held_since: '2026-11-06T11:40:00+03:00', latest_table: null });
    expect(v.title).toBe('3 orders waiting for staff');
    expect(v.detail).toBe('Confirm them on the floor view.');
    expect(v.link).toEqual(FLOOR_SERVICE_LINK);
  });

  it('latest_table present: appended to the detail, singular and plural', () => {
    expect(words({ waiting: 1, oldest_held_since: null, latest_table: 'Table 4' }).detail)
      .toBe('Confirm it on the floor view. Latest: Table 4.');
    expect(words({ waiting: 2, oldest_held_since: null, latest_table: '  Patio 2 ' }).detail)
      .toBe('Confirm them on the floor view. Latest: Patio 2.');
  });

  it('latest_table absent, null, blank or not a string: nothing appended', () => {
    for (const latest of [undefined, null, '', '   ', 7, { name: 'Table 4' }]) {
      const payload: Record<string, unknown> = { waiting: 2, oldest_held_since: null };
      if (latest !== undefined) payload['latest_table'] = latest;
      expect(words(payload).detail).withContext(String(latest)).toBe('Confirm them on the floor view.');
    }
  });

  it('0 waiting: "No orders waiting", handled, and no link', () => {
    const v = words({ waiting: 0, oldest_held_since: null, latest_table: 'Table 4' });
    expect(v.title).toBe('No orders waiting');
    expect(v.detail).toBe('Every waiting order has been handled.');
    expect(v.link).toBeNull();
    expect(v.icon).toBe('waiting');
  });

  it('a malformed payload: neutral words WITH the link, never a guessed count', () => {
    const malformed: Record<string, unknown>[] = [
      {},
      { waiting: null },
      { waiting: '2' },
      { waiting: -1 },
      { waiting: 1.5 },
      { waiting: Number.NaN },
      { waiting: true },
      { waiting: [2] },
    ];
    for (const payload of malformed) {
      const v = words(payload);
      expect(v.title).withContext(JSON.stringify(payload)).toBe('Orders waiting for staff');
      expect(v.detail).toBe('Open the floor view.');
      expect(v.link).toEqual(FLOOR_SERVICE_LINK);
      expect(v.icon).toBe('waiting');
      expect(v.title).not.toBe('No orders waiting');
    }
  });

  it('the payload the inbox reader gives a non-object payload ({}) is the malformed branch', () => {
    const page = readInboxPage({
      data: { unread_count: 1, results: [{ ...base, payload: 'nonsense' }] },
    })!;
    expect(describeNotification(page.items[0]).title).toBe('Orders waiting for staff');
  });

  it('the link is the floor\'s service view', () => {
    expect(FLOOR_SERVICE_LINK).toEqual({ path: '/dining-tables', queryParams: { view: 'service' } });
  });

  it('an unknown kind still renders "New notification"', () => {
    const v = describeNotification({ ...base, kind: 'round_waiting_v2', payload: { waiting: 2 } });
    expect(v.title).toBe('New notification');
    expect(v.icon).toBe('generic');
    expect(v.link).toBeNull();
  });

  it('today\'s kinds are unchanged by the new case', () => {
    expect(describeNotification({ ...base, kind: 'ordering_paused', actor_name: 'Ada' }))
      .toEqual({ title: 'Ordering paused', detail: "Diners can't place new orders. Paused by Ada.", icon: 'paused', link: null });
    expect(describeNotification({ ...base, kind: 'review_low', payload: { rating: 2 } }).link)
      .toEqual({ path: '/reviews/feed', queryParams: { view: 'attention' } });
  });
});

describe('round_waiting — the row on the Notifications page', () => {
  let fixture: ComponentFixture<RestNotificationsComponent>;
  let component: RestNotificationsComponent;
  let http: HttpTestingController;
  let inbox: NotificationInboxService;
  let router: Router;

  function row(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'w1', kind: 'round_waiting', module: 'tables',
      occurred_at: '2026-11-06T12:00:00+03:00', read: false,
      payload: { waiting: 2, oldest_held_since: '2026-11-06T11:50:00+03:00', latest_table: 'Table 4' },
      actor_name: null, ...over,
    };
  }

  function load(results: unknown[], unread: number): void {
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.includes(INBOX_PATH) && !r.url.includes(UNREAD_COUNT_PATH))
      .flush({ status: 200, message: 'ok', data: { results, unread_count: unread } });
    fixture.detectChanges();
  }

  const all = (id: string) => Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];

  beforeEach(async () => {
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
    await TestBed.configureTestingModule({
      declarations: [RestNotificationsComponent],
      imports: [PageHeaderComponent, CardComponent, BadgeComponent, ButtonComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthenticationService,
          useValue: {
            userValue: { token: 't', profile: { id: 'user-1' } },
            currentRestaurantRole: { restaurant_id: 'rest-a', restaurant: 'Bistro A', roles: ['manager'] },
            captureRequestOwner: () => null,
            ownerIsCurrent: () => true,
            logout: jasmine.createSpy('logout'),
          },
        },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info', 'clear', 'dismiss']) },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RestNotificationsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    inbox = TestBed.inject(NotificationInboxService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
  });

  afterEach(() => {
    inbox.stop();
    http.verify();
  });

  it('renders the title, the detail and the waiting icon', () => {
    load([row()], 1);
    expect(all('notification-title')[0].textContent!.trim()).toBe('2 orders waiting for staff');
    expect(all('notification-detail')[0].textContent!.trim()).toBe('Confirm them on the floor view. Latest: Table 4.');
    expect(all('icon-waiting').length).toBe(1);
  });

  it('tapping it opens the floor\'s service view', () => {
    load([row({ read: true })], 0);
    component.open(component.items[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/dining-tables'], { queryParams: { view: 'service' } });
  });

  it('tapping the 0 row leads nowhere', () => {
    load([row({ read: true, payload: { waiting: 0, oldest_held_since: null, latest_table: null } })], 0);
    component.open(component.items[0]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('an unread row is marked read and then followed', () => {
    load([row()], 1);
    component.open(component.items[0]);
    http.expectOne((r) => r.method === 'POST' && r.url.includes(readOnePath('w1')))
      .flush({ status: 200, data: {} });
    http.match((r) => r.url.includes(UNREAD_COUNT_PATH)).forEach((r) => r.flush({ status: 200, data: { unread_count: 0 } }));
    expect(router.navigate).toHaveBeenCalledWith(['/dining-tables'], { queryParams: { view: 'service' } });
  });

  it('against today\'s backend (no round_waiting kind) the rows read as before', () => {
    load([
      { ...row({ id: 'p', kind: 'ordering_paused', payload: {}, actor_name: 'Ada', read: true }) },
      { ...row({ id: 'u', kind: 'something_new', payload: {}, read: true }) },
    ], 0);
    expect(all('notification-title').map((t) => t.textContent!.trim())).toEqual(['Ordering paused', 'New notification']);
    expect(all('icon-waiting').length).toBe(0);
  });
});
