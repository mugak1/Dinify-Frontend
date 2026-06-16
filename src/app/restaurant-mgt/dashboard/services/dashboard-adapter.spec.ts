import { adaptReviewsResponse } from './dashboard-adapter';

// adaptRecentReviews / adaptDistribution are not exported, so they are asserted
// through the public adaptReviewsResponse. Sample payload mirrors the shape
// returned by the reviews/summary/ endpoint.
function rawSummary() {
  return {
    average_rating: '4.2', // backend sends the average as a string
    total_reviews: 10,
    distribution: [
      { stars: 5, count: 6 },
      { stars: 4, count: 2 },
      { stars: 2, count: 1 },
      { stars: 1, count: 1 },
    ],
    critical_count: 2,
    unresolved_critical_count: 1,
    recent_reviews: [
      {
        id: 'rv-1',
        overall_rating: 5,
        comment: 'Great service',
        created_at: '2026-06-01T10:00:00Z',
        resolution_status: 'resolved',
        order_number: 12,
        table_label: 'T1',
      },
      {
        id: 'rv-2',
        overall_rating: 2,
        comment: 'Slow food',
        created_at: '2026-06-02T10:00:00Z',
        resolution_status: 'pending',
      },
    ],
  };
}

describe('dashboard-adapter', () => {
  describe('adaptReviewsResponse', () => {
    it('converts the string average_rating to a number', () => {
      const out = adaptReviewsResponse(rawSummary());
      expect(out.avg_rating).toBe(4.2);
      expect(typeof out.avg_rating).toBe('number');
    });

    it('passes through total_reviews and maps the {stars,count} distribution with computed percentages', () => {
      const out = adaptReviewsResponse(rawSummary());
      expect(out.total_reviews).toBe(10);
      // distribution shape is unchanged: {stars,count} -> {rating,count,percentage}
      expect(out.distribution[0]).toEqual({ rating: 5, count: 6, percentage: 60 });
      expect(out.distribution[2]).toEqual({ rating: 2, count: 1, percentage: 10 });
    });

    it('remaps recent_reviews onto the RecentReview shape', () => {
      const out = adaptReviewsResponse(rawSummary());
      expect(out.recent[0]).toEqual({
        review_id: 'rv-1',
        rating: 5,
        text: 'Great service',
        created_at: '2026-06-01T10:00:00Z',
        resolved: true,
      });
    });

    it('derives resolved from resolution_status === "resolved"', () => {
      const out = adaptReviewsResponse(rawSummary());
      expect(out.recent[0].resolved).toBe(true); // resolution_status: 'resolved'
      expect(out.recent[1].resolved).toBe(false); // resolution_status: 'pending'
    });

    it('leaves low_rating_share unset so the card computes the 1–2★ share from distribution', () => {
      const out = adaptReviewsResponse(rawSummary());
      expect(out.low_rating_share).toBeUndefined();
    });

    it('handles a null/empty payload safely', () => {
      const out = adaptReviewsResponse(null);
      expect(out.avg_rating).toBe(0);
      expect(out.total_reviews).toBe(0);
      expect(out.distribution).toEqual([]);
      expect(out.recent).toEqual([]);
    });
  });
});
