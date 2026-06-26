import { adaptReviewsAnalytics, adaptReviewListItem } from './reviews-adapter';

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

// Sample mirrors one ReviewRestaurantReadSerializer record from the reviews/
// endpoint: string (or null) ratings, snake_case keys, nullable context fields.
function rawReview() {
  return {
    id: 42,
    overall_rating: '4', // backend may send ratings as strings
    food_rating: '5',
    speed_rating: '2',
    service_rating: '3',
    value_rating: null, // diner skipped this dimension
    cleanliness_rating: '4',
    comment: 'Great food but slow service.',
    is_public: true,
    resolution_status: 'open',
    submission_channel: 'qr',
    created_at: '2026-06-15T10:00:00Z',
    updated_at: '2026-06-15T10:00:00Z',
    is_critical: true,
    order_id: 1001,
    order_number: 1042,
    table_label: 'Table 7',
    served_at: '2026-06-15T09:30:00Z',
    spend: '38000.00',
    tags: ['great_flavour', 'spotless'],
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

  describe('adaptReviewListItem', () => {
    it('maps the serializer fields to the camelCase model', () => {
      const out = adaptReviewListItem(rawReview());
      expect(out.id).toBe(42);
      expect(out.overallRating).toBe(4);
      expect(typeof out.overallRating).toBe('number');
      expect(out.comment).toBe('Great food but slow service.');
      expect(out.createdAt).toBe('2026-06-15T10:00:00Z');
      expect(out.orderNumber).toBe(1042);
      expect(out.tableLabel).toBe('Table 7');
      expect(out.spend).toBe('38000.00');
      expect(out.isCritical).toBe(true);
      expect(out.resolutionStatus).toBe('open');
    });

    it('maps the quick-feedback tag keys through as a string array', () => {
      expect(adaptReviewListItem(rawReview()).tags).toEqual(['great_flavour', 'spotless']);
    });

    it('coerces absent/null/non-array tags to an empty array', () => {
      expect(adaptReviewListItem({ ...rawReview(), tags: undefined }).tags).toEqual([]);
      expect(adaptReviewListItem({ ...rawReview(), tags: null }).tags).toEqual([]);
      expect(adaptReviewListItem({ ...rawReview(), tags: 'nope' }).tags).toEqual([]);
    });

    it('drops non-string and blank tag entries so no blank badge renders', () => {
      expect(
        adaptReviewListItem({ ...rawReview(), tags: ['', '  ', 42, null, 'spotless'] }).tags,
      ).toEqual(['spotless']);
    });

    it('parses per-dimension ratings to numbers and preserves null', () => {
      const out = adaptReviewListItem(rawReview());
      expect(out.foodRating).toBe(5);
      expect(out.speedRating).toBe(2);
      expect(out.serviceRating).toBe(3);
      expect(out.cleanlinessRating).toBe(4);
      // value_rating was null — must survive as null, not coerced to 0
      expect(out.valueRating).toBeNull();
    });

    it('defaults a missing comment to an empty string', () => {
      expect(adaptReviewListItem({ ...rawReview(), comment: null }).comment).toBe('');
      expect(adaptReviewListItem({ ...rawReview(), comment: undefined }).comment).toBe('');
    });

    it('keeps the nullable order-context fields null when absent', () => {
      const out = adaptReviewListItem({
        ...rawReview(),
        order_number: null,
        table_label: null,
        spend: null,
      });
      expect(out.orderNumber).toBeNull();
      expect(out.tableLabel).toBeNull();
      expect(out.spend).toBeNull();
    });

    it('coerces is_critical to a boolean', () => {
      expect(adaptReviewListItem({ ...rawReview(), is_critical: false }).isCritical).toBe(false);
      expect(adaptReviewListItem({ ...rawReview(), is_critical: undefined }).isCritical).toBe(false);
    });

    it('normalizes resolution_status — only "resolved" maps to resolved', () => {
      expect(
        adaptReviewListItem({ ...rawReview(), resolution_status: 'resolved' }).resolutionStatus,
      ).toBe('resolved');
      // an unknown or missing status falls back to the safe "open" default
      expect(
        adaptReviewListItem({ ...rawReview(), resolution_status: 'pending' }).resolutionStatus,
      ).toBe('open');
      expect(
        adaptReviewListItem({ ...rawReview(), resolution_status: null }).resolutionStatus,
      ).toBe('open');
    });

    it('maps resolution_note when present, and null when absent/empty', () => {
      expect(
        adaptReviewListItem({ ...rawReview(), resolution_note: 'Comped the meal' }).resolutionNote,
      ).toBe('Comped the meal');
      // absent → null (rawReview omits the field)
      expect(adaptReviewListItem(rawReview()).resolutionNote).toBeNull();
      // explicit null → null
      expect(
        adaptReviewListItem({ ...rawReview(), resolution_note: null }).resolutionNote,
      ).toBeNull();
      // empty string → null, so the "Action taken" line only shows for a real note
      expect(
        adaptReviewListItem({ ...rawReview(), resolution_note: '' }).resolutionNote,
      ).toBeNull();
    });

    it('handles a null/empty payload safely', () => {
      const out = adaptReviewListItem(null);
      expect(out.overallRating).toBe(0);
      expect(out.comment).toBe('');
      expect(out.tags).toEqual([]);
      expect(out.createdAt).toBe('');
      expect(out.orderNumber).toBeNull();
      expect(out.tableLabel).toBeNull();
      expect(out.spend).toBeNull();
      expect(out.isCritical).toBe(false);
      expect(out.resolutionStatus).toBe('open');
      expect(out.resolutionNote).toBeNull();
      expect(out.foodRating).toBeNull();
      expect(out.speedRating).toBeNull();
      expect(out.serviceRating).toBeNull();
      expect(out.valueRating).toBeNull();
      expect(out.cleanlinessRating).toBeNull();
    });
  });
});
