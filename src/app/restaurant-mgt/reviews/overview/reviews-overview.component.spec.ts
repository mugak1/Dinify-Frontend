import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReviewsOverviewComponent } from './reviews-overview.component';


/** The rendered tab buttons of the Nth app-dn-segmented on the page. */
function segTabs(root: HTMLElement, index: number): HTMLButtonElement[] {
  const seg = root.querySelectorAll('app-dn-segmented')[index] as HTMLElement | undefined;
  return seg ? (Array.from(seg.querySelectorAll('button[role="tab"]')) as HTMLButtonElement[]) : [];
}

describe('ReviewsOverviewComponent', () => {
  let component: ReviewsOverviewComponent;
  let fixture: ComponentFixture<ReviewsOverviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Standalone component → goes in imports, not declarations.
      imports: [ReviewsOverviewComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewsOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('always exposes a "View all reviews" link to the feed', () => {
    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
      'a[href="/reviews/feed"]',
    );
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('View all reviews');
  });

  it('defaults to the 90-day timeframe', () => {
    expect(component.timeframeDays).toBe(90);
  });

  it('buildTrendChart maps analytics.trend into chartData labels and averages', () => {
    component.analytics = {
      averageRating: 4.2,
      totalReviews: 20,
      distribution: [],
      dimensions: [],
      weakestDimension: null,
      criticalCount: 0,
      unresolvedCriticalCount: 0,
      trend: [
        { period: '2026-05-04', average: 4.0, count: 12 },
        { period: '2026-05-11', average: 4.5, count: 8 },
      ],
      period: { from: '2026-05-01', to: '2026-05-31', category: '' },
    };

    component.buildTrendChart();

    expect(component.chartData.labels).toEqual(['4 May', '11 May']);
    expect(component.chartData.datasets[0].data).toEqual([4.0, 4.5]);
  });

  // The timeframe is a CHOSEN value, so it is the shared segmented control (ink), not a
  // hand-rolled pale-red copy. A real click must still reach the same setter.
  it('renders the timeframe as the shared segmented control, driving setTimeframe', () => {
    const tabs = segTabs(fixture.nativeElement, 0);
    expect(tabs.map((b) => b.textContent?.trim())).toEqual(['30 days', '90 days']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    const spy = spyOn(component, 'setTimeframe').and.callThrough();
    tabs[0].click();
    expect(spy).toHaveBeenCalledWith(30);
    expect(component.timeframeDays).toBe(30);
  });

  it('ignores a value the timeframe options do not contain', () => {
    const spy = spyOn(component, 'setTimeframe');
    component.onTimeframeValue('7');
    expect(spy).not.toHaveBeenCalled();
  });
});
