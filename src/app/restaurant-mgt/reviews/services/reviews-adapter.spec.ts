import { adaptReviewsAnalytics } from './reviews-adapter';

// Sample payload mirrors the shape returned by the reviews/analytics/ endpoint:
// string (or null) averages, {stars,count} distribution, a dimensions object,
// weakest_dimension, and a trend series.
function rawAnalytics() {
  return {
    period: { from: '2026-03-18', to: '2026-06-16', category: 'all' },
    total_reviews: 20,
    average_rating: '4.2', // backend sends the average as a string
    distribution: [
      { stars: 5, count: 10 },
      { stars: 4, count: 5 },
      { stars: 2, count: 3 },
      { stars: 1, count: 2 },
    ],
    dimensions: {
      food: { average: '4.5', count: 18 },
      speed: { average: '3.1', count: 15 },
      service: { average: null, count: 0 }, // not enough data
      value: { average: '3.8', count: 12 },
      cleanliness: { average: '4.0', count: 10 },
    },
    weakest_dimension: { key: 'speed', average: '3.1' },
    critical_count: 4,
    unresolved_critical_count: 2,
    trend: [
      { period: '2026-W20', average: '4.1', count: 6 },
      { period: '2026-W21', average: '4.3', count: 8 },
    ],
  };
}

describe('reviews-adapter', () => {
  describe('adaptReviewsAnalytics', () => {
    it('converts the string average_rating to a number', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.averageRating).toBe(4.2);
      expect(typeof out.averageRating).toBe('number');
    });

    it('passes through total_reviews and maps the {stars,count} distribution with computed percentages', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.totalReviews).toBe(20);
      expect(out.distribution[0]).toEqual({ rating: 5, count: 10, percentage: 50 });
      expect(out.distribution[2]).toEqual({ rating: 2, count: 3, percentage: 15 });
    });

    it('maps the dimensions object to a labelled array in canonical order', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.dimensions.map((d) => d.key)).toEqual([
        'food',
        'speed',
        'service',
        'value',
        'cleanliness',
      ]);
      expect(out.dimensions.map((d) => d.label)).toEqual([
        'Food',
        'Speed',
        'Service',
        'Value',
        'Cleanliness',
      ]);
    });

    it('parses string dimension averages to numbers and preserves null averages', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      const food = out.dimensions.find((d) => d.key === 'food')!;
      const service = out.dimensions.find((d) => d.key === 'service')!;
      expect(food.average).toBe(4.5);
      expect(typeof food.average).toBe('number');
      expect(food.count).toBe(18);
      // null average must survive — not coerced to 0
      expect(service.average).toBeNull();
      expect(service.count).toBe(0);
    });

    it('maps weakest_dimension and resolves its display label', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.weakestDimension).toEqual({ key: 'speed', label: 'Speed', average: 3.1 });
    });

    it('returns a null weakestDimension when the endpoint sends null', () => {
      const out = adaptReviewsAnalytics({ ...rawAnalytics(), weakest_dimension: null });
      expect(out.weakestDimension).toBeNull();
    });

    it('maps the critical counts', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.criticalCount).toBe(4);
      expect(out.unresolvedCriticalCount).toBe(2);
    });

    it('parses the trend series (string averages to numbers)', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.trend.length).toBe(2);
      expect(out.trend[0]).toEqual({ period: '2026-W20', average: 4.1, count: 6 });
      expect(typeof out.trend[0].average).toBe('number');
    });

    it('passes the period through', () => {
      const out = adaptReviewsAnalytics(rawAnalytics());
      expect(out.period).toEqual({ from: '2026-03-18', to: '2026-06-16', category: 'all' });
    });

    it('handles a null/empty payload safely', () => {
      const out = adaptReviewsAnalytics(null);
      expect(out.averageRating).toBe(0);
      expect(out.totalReviews).toBe(0);
      expect(out.distribution).toEqual([]);
      expect(out.weakestDimension).toBeNull();
      expect(out.criticalCount).toBe(0);
      expect(out.unresolvedCriticalCount).toBe(0);
      expect(out.trend).toEqual([]);
      expect(out.period).toEqual({ from: '', to: '', category: '' });
      // dimensions still resolves to the five canonical rows, all empty
      expect(out.dimensions.length).toBe(5);
      expect(out.dimensions.every((d) => d.average === null && d.count === 0)).toBe(true);
    });
  });
});
