import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TopNavComponent } from './top-nav.component';
import { DashboardService } from '../../dashboard/services/dashboard.service';
import { DateRange } from '../../dashboard/models/dashboard.models';
import { AuthenticationService } from '../../../_services/authentication.service';

describe('TopNavComponent', () => {
  let fixture: ComponentFixture<TopNavComponent>;
  let component: TopNavComponent;
  let dateRange$: BehaviorSubject<DateRange>;
  let isDashboardActive$: BehaviorSubject<boolean>;
  // Getter-backed stub: mirrors the real service's `currentRestaurant` /
  // `currentRestaurantRole` accessors so `restaurantName`'s fallback resolves.
  let auth: { currentRestaurant: { name: string } | null; currentRestaurantRole: { restaurant: string } | null };

  beforeEach(async () => {
    dateRange$ = new BehaviorSubject<DateRange>('day');
    isDashboardActive$ = new BehaviorSubject<boolean>(true);
    auth = { currentRestaurant: null, currentRestaurantRole: { restaurant: 'Test Bistro' } };

    await TestBed.configureTestingModule({
      imports: [TopNavComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: { dateRange$, isDashboardActive$ } },
        { provide: AuthenticationService, useValue: auth },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TopNavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('renders the timeframe rail through the shared segmented control', () => {
    expect(fixture.nativeElement.querySelector('app-dn-segmented')).not.toBeNull();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Day');
    expect(text).toContain('Week');
    expect(text).toContain('Month');
    expect(text).toContain('YTD');
  });

  it('writes range changes to the dashboard service subject', () => {
    spyOn(dateRange$, 'next');
    component.onDateRangeChange('week');
    expect(dateRange$.next).toHaveBeenCalledWith('week');
  });

  it('hides the rail when the dashboard is inactive', () => {
    isDashboardActive$.next(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-dn-segmented')).toBeNull();
  });

  it('surfaces the current restaurant name in the chrome', () => {
    expect(component.restaurantName).toBe('Test Bistro');
    expect((fixture.nativeElement.textContent as string)).toContain('Test Bistro');
  });

  it('prefers the freshly-fetched detail name over the membership label', () => {
    auth.currentRestaurant = { name: 'Renamed Bistro' };
    expect(component.restaurantName).toBe('Renamed Bistro');
  });
});
