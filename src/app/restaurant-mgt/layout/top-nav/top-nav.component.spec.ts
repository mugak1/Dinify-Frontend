import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopNavComponent } from './top-nav.component';
import { OverlayContainer } from '@angular/cdk/overlay';
import { AuthenticationService } from '../../../_services/authentication.service';
import { SessionActionsService } from '../session-actions.service';
import { RestaurantSwitchService } from '../restaurant-switch.service';
import { signal } from '@angular/core';
import { NotificationInboxService } from '../notification-inbox.service';

describe('TopNavComponent', () => {
  let fixture: ComponentFixture<TopNavComponent>;
  let component: TopNavComponent;
  // Getter-backed stub: mirrors the real service's `currentRestaurant` /
  // `currentRestaurantRole` accessors so `restaurantName`'s fallback resolves.
  let auth: {
    currentRestaurant: { name: string } | null;
    currentRestaurantRole: { restaurant: string; roles?: string[] } | null;
    userValue: { profile: { first_name: string; last_name: string } } | null;
  };
  let confirmSignOut: jasmine.Spy;
  // The switcher's surface, stubbed: what the top bar renders from it.
  let switcher: {
    error: ReturnType<typeof signal<string | null>>;
    switching: ReturnType<typeof signal<boolean>>;
    list: any[];
    memberships: () => any[];
    currentRestaurantId: () => string | null;
    requestSwitch: jasmine.Spy;
  };

  let inbox: { unreadCount: ReturnType<typeof signal<number | null>>; start: jasmine.Spy; stop: jasmine.Spy };

  beforeEach(async () => {
    inbox = { unreadCount: signal<number | null>(null), start: jasmine.createSpy('start'), stop: jasmine.createSpy('stop') };
    auth = {
      currentRestaurant: null,
      currentRestaurantRole: { restaurant: 'Test Bistro', roles: ['kitchen'] },
      userValue: { profile: { first_name: 'Ada', last_name: 'Okello' } },
    };
    confirmSignOut = jasmine.createSpy('confirmSignOut');
    switcher = {
      error: signal<string | null>(null),
      switching: signal(false),
      list: [{ restaurant_id: 'r1', restaurant: 'Test Bistro', roles: ['kitchen'] }],
      memberships: () => switcher.list,
      currentRestaurantId: () => 'r1',
      requestSwitch: jasmine.createSpy('requestSwitch'),
    };

    await TestBed.configureTestingModule({
      imports: [TopNavComponent],
      providers: [
        provideRouter([]),
        // No DashboardService: top-nav stopped injecting it when the date-range pills
        // moved to the dashboard's own header (TIMEFRAME-01B). If this provider becomes
        // necessary again, something re-coupled the global chrome to one page's state.
        { provide: AuthenticationService, useValue: auth },
        { provide: SessionActionsService, useValue: { confirmSignOut } },
        { provide: RestaurantSwitchService, useValue: switcher },
        // The bell's count source, stubbed: the bell itself has its own spec.
        { provide: NotificationInboxService, useValue: inbox },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopNavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('surfaces the current restaurant name in the chrome', () => {
    expect(component.restaurantName).toBe('Test Bistro');
    expect((fixture.nativeElement.textContent as string)).toContain('Test Bistro');
  });

  it('prefers the freshly-fetched detail name over the membership label', () => {
    auth.currentRestaurant = { name: 'Renamed Bistro' };
    expect(component.restaurantName).toBe('Renamed Bistro');
  });

  // Ratchet: the timeframe control belongs to the page that owns a timeframe, not to the
  // global chrome. TimeframeService is route-scoped, so a rail here could not read the
  // real range even if someone re-added one.
  it('renders no timeframe rail', () => {
    expect(fixture.nativeElement.querySelector('app-dn-segmented')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-timeframe-picker')).toBeNull();
  });

  it('renders the menu button only when the shell asks for it (the drawer regime)', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="menu-button"]')).toBeNull();
    fixture.componentRef.setInput('showMenuButton', true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="menu-button"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-controls')).toBe('portal-sidebar');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getBoundingClientRect().width).withContext('44px touch target').toBe(44);
    fixture.componentRef.setInput('menuExpanded', true);
    fixture.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  describe('notifications bell (SHELL-FINISH-00 PR 5)', () => {
    it('sits on the right, before the avatar, and opens /notifications', () => {
      const bar = fixture.nativeElement.querySelector('[data-testid="top-bar"]') as HTMLElement;
      const bell = bar.querySelector('[data-testid="notification-bell"]') as HTMLAnchorElement;
      const avatar = bar.querySelector('[data-testid="account-menu-trigger"]') as HTMLElement;
      expect(bell).not.toBeNull();
      expect(bell.getAttribute('href')).toBe('/notifications');
      // DOCUMENT_POSITION_FOLLOWING: the avatar comes after the bell.
      expect(bell.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('starts the count polling with the bar and stops it with the bar', () => {
      expect(inbox.start).toHaveBeenCalledTimes(1);
      fixture.destroy();
      expect(inbox.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('account menu', () => {
    const triggerEl = () => fixture.nativeElement.querySelector('[data-testid="account-menu-trigger"]') as HTMLButtonElement;
    const overlay = () => TestBed.inject(OverlayContainer).getContainerElement();
    const open = async () => {
      triggerEl().click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('the avatar trigger names whose menu it is, with the role through roleLabel', () => {
      expect(triggerEl().getAttribute('aria-label')).toBe('Account menu: Ada Okello, Chef');
      expect(triggerEl().getAttribute('aria-haspopup')).toBe('menu');
      expect(triggerEl().getBoundingClientRect().width).withContext('44px touch target').toBe(44);
    });

    it('the avatar is identity, not an action: neutral, never brand red', () => {
      const avatar = triggerEl().querySelector('app-dn-avatar') as HTMLElement;
      expect(avatar.className).toContain('bg-secondary');
      expect(avatar.className).not.toContain('bg-primary');
    });

    it('lists the name, the role, My account (/account) and Sign out', async () => {
      await open();
      const menu = overlay().querySelector('[data-testid="account-menu"]') as HTMLElement;
      expect(menu.textContent).toContain('Ada Okello');
      expect(menu.textContent).toContain('Chef');
      const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect(items.map(i => i.textContent!.trim())).toEqual(['My account', 'Sign out']);
      expect(items[0].getAttribute('href')).toBe('/account');
    });

    it('Sign out goes through the one confirmation path', async () => {
      await open();
      (overlay().querySelector('[data-testid="menu-sign-out"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(confirmSignOut).toHaveBeenCalledTimes(1);
    });
  });

  describe('venue switcher (SHELL-FINISH-00 PR 3)', () => {
    const q = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    const overlay = () => TestBed.inject(OverlayContainer).getContainerElement();
    const two = [
      { restaurant_id: 'r1', restaurant: 'Test Bistro', roles: ['owner'] },
      { restaurant_id: 'r2', restaurant: 'Cafe Javas', roles: ['kitchen'] },
    ];

    it('one membership shows the plain name and NO switcher control', () => {
      expect(q('venue-switcher-trigger')).toBeNull();
      expect(q('venue-name')!.textContent!.trim()).toBe('Test Bistro');
      expect(fixture.nativeElement.querySelector('[aria-haspopup="menu"][data-testid^="venue"]')).toBeNull();
    });

    it('two or more memberships turn the name into the switcher trigger', async () => {
      switcher.list = two;
      fixture.detectChanges();
      const trigger = q('venue-switcher-trigger') as HTMLButtonElement;
      expect(trigger).not.toBeNull();
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.getAttribute('aria-label')).toBe('Restaurant: Test Bistro. Switch restaurant');
      expect(trigger.getBoundingClientRect().height).withContext('44px touch target').toBe(44);

      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const options = Array.from(overlay().querySelectorAll<HTMLElement>('[data-testid="venue-option"]'));
      expect(options.map(o => o.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio']);
      expect(options.map(o => o.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(options[1].textContent).toContain('Cafe Javas');
      expect(options[1].textContent).toContain('Chef');
      // Chosen is ink, not act: no brand red on the checked row.
      expect(options[0].className).not.toMatch(/\b(bg|text)-(primary|d-red)\b/);

      options[1].click();
      fixture.detectChanges();
      expect(switcher.requestSwitch).toHaveBeenCalledOnceWith(two[1]);
    });

    it('shows the inline error from a failed switch, as an alert in danger ink', () => {
      switcher.error.set("Couldn't switch restaurants right now. Check your connection and try again.");
      fixture.detectChanges();
      const err = q('venue-switch-error')!;
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.className).toContain('text-destructive');
      expect(err.textContent).toContain("Couldn't switch restaurants");
    });

    it('the trigger is disabled while a switch is under way', () => {
      switcher.list = two;
      switcher.switching.set(true);
      fixture.detectChanges();
      const trigger = q('venue-switcher-trigger') as HTMLButtonElement;
      expect(trigger.disabled).toBeTrue();
      expect(trigger.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('height (explicit px; the 14px root makes rem drift)', () => {
    it('is 56px on a standard route and 48px on Menu’s compact bar, with or without the menu button', () => {
      document.body.appendChild(fixture.nativeElement);
      const bar = () => fixture.nativeElement.querySelector('[data-testid="top-bar"]') as HTMLElement;
      for (const showMenuButton of [false, true]) {
        fixture.componentRef.setInput('showMenuButton', showMenuButton);
        fixture.componentRef.setInput('compact', false);
        fixture.detectChanges();
        expect(bar().getBoundingClientRect().height).withContext(`standard, menu=${showMenuButton}`).toBe(56);
        fixture.componentRef.setInput('compact', true);
        fixture.detectChanges();
        expect(bar().getBoundingClientRect().height).withContext(`compact, menu=${showMenuButton}`).toBe(48);
      }
      fixture.nativeElement.remove();
    });
  });
});
