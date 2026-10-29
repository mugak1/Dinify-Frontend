import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TopNavComponent } from './top-nav.component';
import { AuthenticationService } from '../../../_services/authentication.service';

describe('TopNavComponent', () => {
  let fixture: ComponentFixture<TopNavComponent>;
  let component: TopNavComponent;
  // Getter-backed stub: mirrors the real service's `currentRestaurant` /
  // `currentRestaurantRole` accessors so `restaurantName`'s fallback resolves.
  let auth: { currentRestaurant: { name: string } | null; currentRestaurantRole: { restaurant: string } | null };

  beforeEach(async () => {
    auth = { currentRestaurant: null, currentRestaurantRole: { restaurant: 'Test Bistro' } };

    await TestBed.configureTestingModule({
      imports: [TopNavComponent],
      providers: [
        provideRouter([]),
        // No DashboardService: top-nav stopped injecting it when the date-range pills
        // moved to the dashboard's own header (TIMEFRAME-01B). If this provider becomes
        // necessary again, something re-coupled the global chrome to one page's state.
        { provide: AuthenticationService, useValue: auth },
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
});
