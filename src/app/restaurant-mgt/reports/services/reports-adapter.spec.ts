// Response-shape contract pins for the reports real-data path.
//
// Each adapter is fed the EXACT `data` shape the backend emits (derived from
// Dinify-Backend reports_app controllers/serializers), and we assert it maps
// every field. These are the flip-time safety net for the second class of
// latent bug the mock hides: a correct slug whose parser reads keys the backend
// never sends. The three marked REGRESSION cases each FAIL against the pre-fix
// adapter and PASS after — see H1/M3.

import {
  adaptDinersListing,
  adaptDinersSummary,
  adaptMenuSummary,
  adaptSalesAggregate,
  adaptSalesListing,
  adaptTransactionsListing,
  adaptTransactionsSummary,
} from './reports-adapter';

describe('reports-adapter (backend response-shape contract)', () => {
  describe('adaptSalesAggregate (sales-trends table → SalesAggregateRow[])', () => {
    // Backend: reports_app/.../sales.py → data: [{period, count, revenue, discount}]
    it('maps the backend `count` onto orders [REGRESSION: H1/M3]', () => {
      const rows = adaptSalesAggregate([
        { period: '2026-06-01', count: 5, revenue: 12000, discount: 1500 },
      ]);
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({ period: '2026-06-01', orders: 5, revenue: 12000, discount: 1500 });
    });

    it('still honours the legacy `order_count` / records / results fallbacks', () => {
      expect(adaptSalesAggregate({ records: [{ period: 'p', order_count: 3 }] })[0].orders).toBe(3);
      expect(adaptSalesAggregate({ results: [{ period: 'p', orders: 2 }] })[0].orders).toBe(2);
    });
  });

  describe('adaptMenuSummary (menu-summary → MenuRow[])', () => {
    // Backend: menu.py → data: { grouping, rows: [{name, order_count, quantity_sold, revenue}] }
    it('unwraps the `rows` envelope the backend wraps the menu in [REGRESSION: H1/M3]', () => {
      const rows = adaptMenuSummary({
        grouping: 'sections',
        rows: [{ name: 'Starters', order_count: 4, quantity_sold: 11, revenue: 33000 }],
      });
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({
        name: 'Starters',
        order_count: 4,
        quantity_sold: 11,
        revenue: 33000,
      });
    });

    it('returns [] for an unrecognised shape (graceful, not a throw)', () => {
      expect(adaptMenuSummary({ grouping: 'sections' })).toEqual([]);
    });
  });

  describe('adaptDinersSummary (diners-summary → DinersSummary)', () => {
    // Backend: diners.py → { identified_diners, repeat_diners, guest_orders,
    //   average_spend_per_identified_diner, most_active_diner: {name, order_count, total_spend} }
    it('reads average_spend_per_identified_diner and most_active_diner [REGRESSION: H1/M3]', () => {
      const s = adaptDinersSummary({
        identified_diners: 10,
        repeat_diners: 4,
        guest_orders: 20,
        average_spend_per_identified_diner: 2500,
        most_active_diner: { name: 'Jane D', order_count: 7, total_spend: 17500 },
      });
      expect(s.identifiedDiners).toBe(10);
      expect(s.repeatDiners).toBe(4);
      expect(s.guestOrders).toBe(20);
      expect(s.avgSpendPerDiner).toBe(2500);
      expect(s.mostActive).toEqual({ name: 'Jane D', totalSpend: 17500 });
    });

    it('leaves mostActive undefined when the backend sends null', () => {
      const s = adaptDinersSummary({ identified_diners: 1, most_active_diner: null });
      expect(s.mostActive).toBeUndefined();
    });
  });

  describe('adaptTransactionsSummary (transactions-summary → TransactionsSummary)', () => {
    // Backend: transactions.py → { total_transactions, by_status[], by_type[] }
    it('reads total_transactions and the status/type breakdowns', () => {
      const s = adaptTransactionsSummary({
        total_transactions: 12,
        by_status: [{ status: 'success', count: 8, amount: 80000 }],
        by_type: [{ type: 'order_payment', count: 8, amount: 80000 }],
      });
      expect(s.totalCount).toBe(12);
      expect(s.byStatus).toEqual([{ status: 'success', count: 8, amount: 80000 }]);
      // order_payment → the FE token `payment` [REGRESSION: order_* type vocab].
      expect(s.byType).toEqual([{ type: 'payment', count: 8, amount: 80000 }]);
    });

    it('normalises every backend order_* type, refunds NOT collapsed to payment', () => {
      const s = adaptTransactionsSummary({
        by_type: [
          { type: 'order_payment', count: 1, amount: 10 },
          { type: 'order_refund', count: 2, amount: 20 },
          { type: 'order_charge', count: 3, amount: 30 },
          { type: 'subscription', count: 4, amount: 40 },
        ],
      });
      expect(s.byType.map((r) => r.type)).toEqual(['payment', 'refund', 'charge', 'subscription']);
    });
  });

  describe('listing adapters (already-clean field maps — pinned to prevent drift)', () => {
    it('adaptSalesListing maps the SerializerOrderListingReport row', () => {
      const [row] = adaptSalesListing([
        {
          order_number: 'ORD-0001',
          item_count: 2,
          gross: 5000,
          discount: 500,
          revenue: 4500,
          payment_mode: 'momo', // real backend vocab: cash|momo|card
          payment_status: 'paid',
          time_created: '2026-06-01T10:00:00Z',
        },
      ]);
      expect(row.order_number).toBe('ORD-0001');
      expect(row.item_count).toBe(2);
      expect(row.gross).toBe(5000);
      expect(row.discount).toBe(500);
      expect(row.revenue).toBe(4500);
      expect(row.payment_status).toBe('paid');
      expect(row.time_created).toBe('2026-06-01T10:00:00Z');
      // KNOWN GAP (documented follow-up): backend payment_mode is cash|momo|card;
      // the FE PaymentMode union is MTN MoMo|Airtel MoMo|Cash. The adapter passes
      // the raw token through (the Method column renders it as plain text), so it
      // is not yet mapped. Pinned here so the gap is visible, not silent.
      expect(row.payment_mode as string).toBe('momo');
    });

    it('adaptTransactionsListing maps the row and normalises the order_* type', () => {
      const [row] = adaptTransactionsListing([
        {
          order_number: 'ORD-0002',
          transaction_type: 'order_refund',
          transaction_status: 'success',
          amount: 4500,
          payment_mode: 'momo',
          transaction_platform: 'yo',
          time_created: '2026-06-01T10:00:00Z',
        },
      ]);
      expect(row.order_number).toBe('ORD-0002');
      // order_refund must NOT collapse to 'payment' [REGRESSION: order_* type vocab].
      expect(row.transaction_type).toBe('refund');
      expect(row.transaction_status).toBe('success');
      expect(row.amount).toBe(4500);
      expect(row.transaction_platform).toBe('yo');
      expect(row.time_created).toBe('2026-06-01T10:00:00Z');
      expect(row.payment_mode as string).toBe('momo'); // KNOWN payment_mode gap (see above)
    });

    it('adaptDinersListing maps the diners-listing row', () => {
      const rows = adaptDinersListing([
        {
          customer_id: 'c1',
          name: 'Jane D',
          phone_number: '0700000000',
          no_orders: 7,
          total_spend: 17500,
          average_spend: 2500,
          last_order_date: '2026-06-01T10:00:00Z',
        },
      ]);
      expect(rows[0]).toEqual({
        customer_id: 'c1',
        name: 'Jane D',
        phone_number: '0700000000',
        no_orders: 7,
        total_spend: 17500,
        average_spend: 2500,
        last_order_date: '2026-06-01T10:00:00Z',
      });
    });
  });
});
