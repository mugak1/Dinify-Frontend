import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ReviewsCardComponent } from './reviews-card.component';
import { ReviewsSummaryResponse } from '../../models/dashboard.models';

/**
 * The Guest Reviews card now describes the dashboard's selected window, which makes an
 * empty window an ordinary state — "Today" with nothing reviewed yet. The invariant is the
 * one every other dashboard card keeps: a window with nothing in it SAYS so, rather than
 * rendering structure with zeros in it. An average of no reviews is not 0.0, and five empty
 * stars above a row of zero bars reads as a dreadful rating rather than an absent one.
 */

const review = (id: string, rating: number, text: string) => ({
  review_id: id,
  rating,
  text,
  created_at: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString(),
  resolved: false,
});

const EMPTY_WINDOW: ReviewsSummaryResponse = {
  avg_rating: 0,
  total_reviews: 0,
  distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0, percentage: 0 })),
  recent: [],
};

const TWO_REVIEWS: ReviewsSummaryResponse = {
  avg_rating: 5,
  total_reviews: 2,
  distribution: [
    { rating: 5, count: 2, percentage: 100 },
    { rating: 4, count: 0, percentage: 0 },
    { rating: 3, count: 0, percentage: 0 },
    { rating: 2, count: 0, percentage: 0 },
    { rating: 1, count: 0, percentage: 0 },
  ],
  recent: [review('1', 5, 'Meat was fantastic'), review('2', 5, 'Very nice restaurant')],
};

describe('ReviewsCardComponent', () => {
  let fixture: ComponentFixture<ReviewsCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewsCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(data: ReviewsSummaryResponse): HTMLElement {
    fixture = TestBed.createComponent(ReviewsCardComponent);
    fixture.componentRef.setInput('reviewsData', data);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  describe('a window with no reviews', () => {
    it('says so, instead of a 0.0 rating over five empty stars', () => {
      const host = render(EMPTY_WINDOW);

      expect(host.querySelector('[data-testid="reviews-empty"]')?.textContent?.trim())
        .toBe('No reviews in this period');
      expect(host.querySelector('app-animated-number')).toBeNull();
      expect(host.querySelectorAll('svg polygon').length).toBe(0);
      expect(host.querySelectorAll('[style*="width"]').length).toBe(0);
    });

    it('never quotes reviews under "no reviews", whatever the server listed', () => {
      // An older server lists its three newest reviews of ALL time beside counts for a
      // rolling 30 days — the exact shape that produced "0 reviews" above five-star quotes.
      const host = render({ ...EMPTY_WINDOW, recent: TWO_REVIEWS.recent });

      expect(host.textContent).toContain('No reviews in this period');
      expect(host.textContent).not.toContain('Meat was fantastic');
      expect(host.textContent).not.toContain('Very nice restaurant');
    });

    it('keeps the header and the way into the full feed', () => {
      const host = render(EMPTY_WINDOW);

      expect(host.textContent).toContain('Guest Reviews');
      expect(host.querySelector('a[href="/reviews/feed"]')).not.toBeNull();
    });
  });

  describe('a window with reviews', () => {
    it('renders the rating, the count, the histogram and the quotes', () => {
      const host = render(TWO_REVIEWS);

      expect(host.querySelector('[data-testid="reviews-empty"]')).toBeNull();
      expect(host.querySelectorAll('app-animated-number').length).toBe(2);
      expect(host.textContent).toContain('Meat was fantastic');
      expect(host.textContent).toContain('Very nice restaurant');
      // Five distribution bars, and the 5-star one is full.
      const bars = host.querySelectorAll<HTMLElement>('[style*="width"]');
      expect(bars.length).toBe(5);
      expect(bars[0].style.width).toBe('100%');
    });

    it('describes the low-rating share as the selected period, not "this month"', () => {
      const host = render({
        avg_rating: 2,
        total_reviews: 2,
        distribution: [
          { rating: 5, count: 0, percentage: 0 },
          { rating: 4, count: 0, percentage: 0 },
          { rating: 3, count: 0, percentage: 0 },
          { rating: 2, count: 1, percentage: 50 },
          { rating: 1, count: 1, percentage: 50 },
        ],
        recent: [],
      });

      expect(host.textContent).toContain('of reviews in this period are 1-2 stars');
      expect(host.textContent).not.toContain('this month');
    });
  });
});
