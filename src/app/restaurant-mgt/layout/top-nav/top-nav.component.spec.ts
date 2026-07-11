import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TopNavComponent } from './top-nav.component';
import { DashboardService } from '../../dashboard/services/dashboard.service';
import { DateRange } from '../../dashboard/models/dashboard.models';

describe('TopNavComponent', () => {
  let fixture: ComponentFixture<TopNavComponent>;
  let component: TopNavComponent;
  let dateRange$: BehaviorSubject<DateRange>;
  let isDashboardActive$: BehaviorSubject<boolean>;

  beforeEach(async () => {
    dateRange$ = new BehaviorSubject<DateRange>('day');
    isDashboardActive$ = new BehaviorSubject<boolean>(true);

    await TestBed.configureTestingModule({
      imports: [TopNavComponent],
      providers: [
        provideRouter([]),
        { provide: DashboardService, useValue: { dateRange$, isDashboardActive$ } },
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
});
