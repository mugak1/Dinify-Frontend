import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { ErrorInterceptor, SILENT_FAILURE } from 'src/app/_helpers/error.interceptor';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ConnectivityService } from 'src/app/_services/connectivity.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { BadgeComponent } from 'src/app/_shared/ui/badge/badge.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { CardComponent } from 'src/app/_shared/ui/card/card.component';
import { PageHeaderComponent } from 'src/app/_shared/ui/page-header/page-header.component';
import { NotificationBellComponent } from '../layout/notification-bell/notification-bell.component';
import { NotificationInboxService, UNREAD_COUNT_PATH } from '../layout/notification-inbox.service';
import { INBOX_PATH, READ_ALL_PATH, RestNotificationsComponent, readOnePath } from './rest-notifications.component';
import { describeNotification, readInboxPage } from './inbox-notification';

/**
 * SHELL-FINISH-00, PR 5 — the Notifications page on the in-app inbox.
 *
 * The page is driven through the REAL ApiService, HttpClient and ErrorInterceptor,
 * so its four states, its silence on a failed load and its reads are claims
 * about the deployed chain.
 */
describe('RestNotificationsComponent (the in-app inbox)', () => {
  let fixture: ComponentFixture<RestNotificationsComponent>;
  let component: RestNotificationsComponent;
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  let inbox: NotificationInboxService;
  let router: Router;
  let auth: any;

  function row(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'n1', kind: 'ordering_paused', module: 'tables',
      occurred_at: '2026-10-29T18:00:00+00:00', read: false,
      payload: { accepting_orders: false }, actor_name: 'Ada', ...over,
    };
  }

  function body(results: unknown[], unread: number): object {
    return { status: 200, message: 'Notifications retrieved', data: { results, unread_count: unread } };
  }

  const isList = (r: { method: string; url: string }) =>
    r.method === 'GET' && r.url.includes(INBOX_PATH) && !r.url.includes(UNREAD_COUNT_PATH);

  function listRequest(): TestRequest {
    return http.expectOne(isList);
  }

  function load(results: unknown[], unread: number): void {
    fixture.detectChanges();
    listRequest().flush(body(results, unread));
    fixture.detectChanges();
  }

  const el = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const all = (id: string) => Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];

  beforeEach(async () => {
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info', 'clear', 'dismiss']);
    auth = {
      userValue: { token: 't', profile: { id: 'user-1' } },
      currentRestaurantRole: { restaurant_id: 'rest-a', restaurant: 'Bistro A', roles: ['manager'] },
      captureRequestOwner: () => null,
      ownerIsCurrent: () => true,
      logout: jasmine.createSpy('logout'),
    };
    await TestBed.configureTestingModule({
      declarations: [RestNotificationsComponent],
      imports: [PageHeaderComponent, CardComponent, BadgeComponent, ButtonComponent, NotificationBellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthenticationService, useValue: auth },
        { provide: ToastService, useValue: toast },
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

  describe('renders its four states on the new source', () => {
    it('loading: until the inbox answers, no empty-state flash', () => {
      fixture.detectChanges();
      const req = listRequest();
      expect(req.request.url).toContain('restaurant=rest-a');
      expect(component.state).toBe('loading');
      expect(el('notifications-loading')).not.toBeNull();
      expect(el('notifications-empty')).toBeNull();
      req.flush(body([], 0));
    });

    it('empty: the server says there is nothing', () => {
      load([], 0);
      expect(component.state).toBe('empty');
      expect(el('notifications-empty')!.textContent).toContain("You're all caught up");
    });

    it('error: a failed load shows the inline error, once, with no toast, and Retry loads again', () => {
      fixture.detectChanges();
      const req = listRequest();
      expect(req.request.context.get(SILENT_FAILURE)).toBeTrue();
      req.flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(component.state).toBe('error');
      expect(el('notifications-error')).not.toBeNull();
      expect(toast.error).not.toHaveBeenCalled();

      el('notifications-retry')!.click();
      fixture.detectChanges();
      expect(component.state).toBe('loading');
      listRequest().flush(body([row()], 1));
      fixture.detectChanges();
      expect(component.state).toBe('ready');
    });

    it('error, not "all caught up": an unreadable answer is never read as an empty inbox', () => {
      fixture.detectChanges();
      listRequest().flush({ status: 200, data: { results: 'nope', unread_count: 0 } });
      fixture.detectChanges();
      expect(component.state).toBe('error');
      expect(el('notifications-empty')).toBeNull();
    });

    it('error without a selected restaurant, and no request is sent', () => {
      auth.currentRestaurantRole = null;
      fixture.detectChanges();
      expect(component.state).toBe('error');
      http.expectNone(isList);
    });

    it('ready: one row per notification, in the server\'s order, worded from kind and payload', () => {
      load([
        row({ id: 'r', kind: 'review_low', module: 'reviews', payload: { review_id: 7, rating: 2 }, actor_name: null }),
        row({ id: 's', kind: 'item_sold_out', payload: { menu_item_id: 'm', item_name: 'Rolex' }, read: true }),
        row({ id: 'p', kind: 'ordering_paused' }),
        row({ id: 'o', kind: 'ordering_resumed', payload: { accepting_orders: true }, actor_name: null }),
      ], 3);
      expect(component.state).toBe('ready');
      expect(all('notification-title').map((t) => t.textContent!.trim())).toEqual([
        'New 2-star review', 'Rolex is sold out', 'Ordering paused', 'Ordering resumed',
      ]);
      expect(all('notification-row').map((r) => r.getAttribute('data-read'))).toEqual(['false', 'true', 'false', 'false']);
      expect(el('unread-badge')!.textContent).toContain('3 unread');
      expect(el('mark-all-read')).not.toBeNull();
    });
  });

  describe('marking read updates the badge', () => {
    it('opening an unread row marks it read on the server and at once on the bell', () => {
      // The real bell, sharing the real root service with the page.
      const bell = TestBed.createComponent(NotificationBellComponent);
      bell.detectChanges();
      http.expectOne((r) => r.url.includes(UNREAD_COUNT_PATH)).flush({ status: 200, data: { unread_count: 2 } });
      bell.detectChanges();
      const badge = () => (bell.nativeElement.querySelector('[data-testid="notification-badge"]') as HTMLElement | null)?.textContent?.trim() ?? null;
      expect(badge()).toBe('2');

      load([row({ id: 'a' }), row({ id: 'b' })], 2);
      all('notification-row')[0].click();
      fixture.detectChanges();
      bell.detectChanges();
      expect(badge()).toBe('1');
      expect(component.unreadCount).toBe(1);

      const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith(readOnePath('a')));
      post.flush({ status: 200, message: 'Marked as read' });
      // The bell then re-asks the server, silently.
      const recount = http.expectOne((r) => r.url.includes(UNREAD_COUNT_PATH));
      expect(recount.request.context.get(SILENT_FAILURE)).toBeTrue();
      recount.flush({ status: 200, data: { unread_count: 1 } });
      bell.detectChanges();
      expect(badge()).toBe('1');
      bell.destroy();
    });

    it('a failed read puts the row back as unread and the count back up', () => {
      load([row({ id: 'a' })], 1);
      component.open(component.items[0]);
      expect(inbox.unreadCount()).toBe(0);
      http.expectOne((r) => r.method === 'POST' && r.url.endsWith(readOnePath('a')))
        .flush({ message: 'Server error' }, { status: 500, statusText: 'Server Error' });
      expect(component.items[0].read).toBeFalse();
      expect(component.unreadCount).toBe(1);
      expect(inbox.unreadCount()).toBe(1);
    });

    it('an already-read row sends nothing', () => {
      load([row({ id: 'a', read: true })], 0);
      component.open(component.items[0]);
      http.expectNone((r) => r.method === 'POST');
    });

    it('"Mark all as read" marks every row, zeroes the bell and re-asks', () => {
      load([row({ id: 'a' }), row({ id: 'b' })], 2);
      el('mark-all-read')!.click();
      const post = http.expectOne((r) => r.method === 'POST' && r.url.includes(READ_ALL_PATH));
      expect(post.request.url).toContain('restaurant=rest-a');
      post.flush({ status: 200, message: 'Marked all as read', data: { marked: 2 } });
      fixture.detectChanges();
      expect(component.items.every((n) => n.read)).toBeTrue();
      expect(inbox.unreadCount()).toBe(0);
      expect(el('mark-all-read')).toBeNull();
      http.expectOne((r) => r.url.includes(UNREAD_COUNT_PATH)).flush({ status: 200, data: { unread_count: 0 } });
    });

    it('the list response sets the bell\'s count too', () => {
      load([row({ id: 'a' })], 1);
      expect(inbox.unreadCount()).toBe(1);
    });
  });

  it('a low-review row opens the review queue; the others lead nowhere', () => {
    load([
      row({ id: 'r', kind: 'review_low', module: 'reviews', payload: { review_id: 7, rating: 1 }, read: true }),
      row({ id: 'p', kind: 'ordering_paused', read: true }),
    ], 0);
    component.open(component.items[0]);
    expect(router.navigate).toHaveBeenCalledWith(['/reviews/feed'], { queryParams: { view: 'attention' } });
    (router.navigate as jasmine.Spy).calls.reset();
    component.open(component.items[1]);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('inbox-notification (reading and wording)', () => {
  const base = {
    id: 'n', kind: 'ordering_paused', module: 'tables', occurred_at: '2026-10-29T18:00:00Z',
    read: false, payload: {}, actor_name: null,
  };

  it('names the person who acted, and says nothing when nobody is named', () => {
    expect(describeNotification({ ...base, actor_name: 'Ada' }).detail).toBe("Diners can't place new orders. Paused by Ada.");
    expect(describeNotification(base).detail).toBe("Diners can't place new orders. Paused.");
  });

  it('a kind this build does not know still renders, neutrally', () => {
    const v = describeNotification({ ...base, kind: 'something_new' });
    expect(v.title).toBe('New notification');
    expect(v.link).toBeNull();
  });

  it('a review with no readable rating still renders', () => {
    expect(describeNotification({ ...base, kind: 'review_low', payload: { rating: 'x' } }).title).toBe('New low review');
  });

  it('a sold-out with no name says "A dish"', () => {
    expect(describeNotification({ ...base, kind: 'item_sold_out', payload: {} }).title).toBe('A dish is sold out');
  });

  it('refuses a page with a malformed row, a missing count or no results', () => {
    const ok = { id: 'a', kind: 'k', module: 'tables', occurred_at: '2026-10-29T18:00:00Z', read: false, payload: {}, actor_name: null };
    expect(readInboxPage({ data: { results: [ok], unread_count: 1 } })?.items.length).toBe(1);
    expect(readInboxPage({ data: { results: [{ ...ok, read: 'no' }], unread_count: 1 } })).toBeNull();
    expect(readInboxPage({ data: { results: [{ ...ok, occurred_at: 'not a date' }], unread_count: 1 } })).toBeNull();
    expect(readInboxPage({ data: { results: [ok] } })).toBeNull();
    expect(readInboxPage({ data: { unread_count: 0 } })).toBeNull();
    expect(readInboxPage(null)).toBeNull();
  });
});
