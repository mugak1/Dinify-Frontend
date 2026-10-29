import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopNavComponent } from './top-nav.component';
import { OverlayContainer } from '@angular/cdk/overlay';
import { AuthenticationService } from '../../../_services/authentication.service';
import { SessionActionsService } from '../session-actions.service';

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

  beforeEach(async () => {
    auth = {
      currentRestaurant: null,
      currentRestaurantRole: { restaurant: 'Test Bistro', roles: ['kitchen'] },
      userValue: { profile: { first_name: 'Ada', last_name: 'Okello' } },
    };
    confirmSignOut = jasmine.createSpy('confirmSignOut');

    await TestBed.configureTestingModule({
      imports: [TopNavComponent],
      providers: [
        provideRouter([]),
        // No DashboardService: top-nav stopped injecting it when the date-range pills
        // moved to the dashboard's own header (TIMEFRAME-01B). If this provider becomes
        // necessary again, something re-coupled the global chrome to one page's state.
        { provide: AuthenticationService, useValue: auth },
        { provide: SessionActionsService, useValue: { confirmSignOut } },
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
