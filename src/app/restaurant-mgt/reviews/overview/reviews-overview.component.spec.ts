import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReviewsOverviewComponent } from './reviews-overview.component';

describe('ReviewsOverviewComponent', () => {
  let component: ReviewsOverviewComponent;
  let fixture: ComponentFixture<ReviewsOverviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Standalone component → goes in imports, not declarations.
      imports: [ReviewsOverviewComponent],
      providers: [
        provideHttpClient(),
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
});
