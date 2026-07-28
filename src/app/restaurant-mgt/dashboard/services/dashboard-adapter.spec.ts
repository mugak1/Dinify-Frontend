import { adaptDashboardResponse, adaptReviewsResponse } from './dashboard-adapter';

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

// A dashboard-v2 revenue/orders payload in WIRE shape, WITHOUT `previous_totals` /
// `previous_total` — i.e. what the backend sends once it drops them. Note the wire
// spellings the adapter has to translate: orders series points carry `count`, not
// `orders`, and `breakdown` is an ARRAY of {status,count}, not an object.
function rawDashboard() {
  return {
    revenue: {
      series: [{ at: '2026-06-01T00:00:00Z', gross: '1000', discounts: '100', refunds: '50' }],
      totals: { gross: '1000', net: '850', discounts: '100', refunds: '50' },
    },
    orders: {
      series: [{ at: '2026-06-01T00:00:00Z', count: 7 }],
      breakdown: [
        { status: 'paid', count: 5 },
        { status: 'cancelled', count: 2 },
      ],
      total: 7,
    },
  };
}

describe('dashboard-adapter', () => {
  // DASH-DROP-PREVIOUS-00. This is the layer the backend removal actually lands on: the
  // adapter is what runs against the live API once USE_MOCK_DATA flips, and it used to
  // populate `previous_totals` / `previous_total` from the wire. Nothing had covered
  // adaptDashboardResponse at all, so those reads were removed unpinned — hence these.
  describe('adaptDashboardResponse — no previous_totals on the wire', () => {
    it('adapts revenue and orders from a payload that omits the dropped fields', () => {
      const out = adaptDashboardResponse(rawDashboard());

      expect(out.revenue.totals).toEqual({ gross: 1000, net: 850, discounts: 100, refunds: 50 });
      expect(out.orders.total).toBe(7);
      expect(out.orders.breakdown).toEqual({ paid: 5, open: 0, cancelled: 2, refunded: 0 });
      expect(out.orders.series).toEqual([{ at: '2026-06-01T00:00:00Z', orders: 7 }]);
    });

    // `in` rather than a toEqual/toBeUndefined: Jasmine treats an absent key and a key
    // holding `undefined` as equal, which is exactly the distinction being asserted.
    it('does not resurrect the dropped fields as zeroed keys', () => {
      const out = adaptDashboardResponse(rawDashboard());

      expect('previous_totals' in out.revenue).toBeFalse();
      expect('previous_total' in out.orders).toBeFalse();
    });

    // The two `if (!raw)` guards. An absent section must not throw and must not leave a
    // caller reading `undefined.totals`.
    it('returns zeroed sections when revenue and orders are absent entirely', () => {
      const out = adaptDashboardResponse({});

      expect(out.revenue.totals).toEqual({ gross: 0, net: 0, discounts: 0, refunds: 0 });
      expect(out.revenue.series).toEqual([]);
      expect(out.orders.total).toBe(0);
      expect(out.orders.breakdown).toEqual({ paid: 0, open: 0, cancelled: 0, refunded: 0 });
      expect('previous_totals' in out.revenue).toBeFalse();
      expect('previous_total' in out.orders).toBeFalse();
    });
  });

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
