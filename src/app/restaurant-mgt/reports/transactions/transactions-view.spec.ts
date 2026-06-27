import { TransactionsSummary } from '../models/reports.models';
import {
  filterChipParam,
  isCashMode,
  listingDisplayStatus,
  methodDisplay,
  recentWindow,
  statusBreakdown,
  txnSummaryMetrics,
  typeDisplay,
} from './transactions-view';

const SUMMARY: TransactionsSummary = {
  byStatus: [
    { status: 'success', count: 8, amount: 800000 },
    { status: 'pending', count: 2, amount: 150000 },
    { status: 'failed', count: 1, amount: 50000 },
  ],
  byType: [
    { type: 'payment', count: 8, amount: 800000 },
    { type: 'refund', count: 2, amount: 90000 },
  ],
  totalCount: 11,
};

describe('transactions-view (pure)', () => {
  describe('provisional display vocab', () => {
    it('maps backend method tokens but passes the mock friendly values through', () => {
      expect(methodDisplay('momo')).toBe('Mobile money');
      expect(methodDisplay('card')).toBe('Card');
      expect(methodDisplay('cash')).toBe('Cash');
      expect(methodDisplay('MTN MoMo')).toBe('MTN MoMo'); // mock passthrough
    });

    it('flags cash (self-reported) regardless of case', () => {
      expect(isCashMode('Cash')).toBeTrue();
      expect(isCashMode('cash')).toBeTrue();
      expect(isCashMode('MTN MoMo')).toBeFalse();
    });

    it('labels transaction types', () => {
      expect(typeDisplay('payment')).toBe('Payment');
      expect(typeDisplay('refund')).toBe('Refund');
    });

    it('maps the listing status to a report-table pill token (success→paid, refund→refunded)', () => {
      expect(listingDisplayStatus('payment', 'success')).toBe('paid');
      expect(listingDisplayStatus('refund', 'success')).toBe('refunded');
      expect(listingDisplayStatus('payment', 'pending')).toBe('pending');
    });
  });

  describe('txnSummaryMetrics', () => {
    it('derives count / gross (settled) / avg ticket / refunds (mock)', () => {
      expect(txnSummaryMetrics(SUMMARY)).toEqual({
        count: 11,
        gross: 800000, // success amount
        avgTicket: Math.round(800000 / 11),
        refunds: 90000, // refund-type amount
      });
    });

    it('returns zeros for a null summary', () => {
      expect(txnSummaryMetrics(null).count).toBe(0);
    });
  });

  describe('statusBreakdown', () => {
    it('zero-fills onto Paid / Refunded / Pending and computes the footer rates', () => {
      const b = statusBreakdown(SUMMARY);
      expect(b.buckets.map((x) => x.label)).toEqual(['Paid', 'Refunded', 'Pending']);
      expect(b.buckets[0].count).toBe(8); // Paid ← success
      expect(b.buckets[1].count).toBe(2); // Refunded ← refund type
      expect(b.buckets[1].mockOnly).toBeTrue();
      expect(b.buckets[0].pct).toBe(100); // widest amount
      expect(b.settledPct).toBeCloseTo((8 / 11) * 100, 5);
      expect(b.refundRate).toBeCloseTo((2 / 8) * 100, 5);
    });

    it('zero-fills missing buckets rather than dropping them', () => {
      const b = statusBreakdown({ byStatus: [{ status: 'success', count: 3, amount: 300 }], byType: [], totalCount: 3 });
      expect(b.buckets.length).toBe(3);
      expect(b.buckets.find((x) => x.key === 'refunded')!.count).toBe(0);
      expect(b.buckets.find((x) => x.key === 'pending')!.count).toBe(0);
    });
  });

  describe('filterChipParam', () => {
    it('maps status chips onto ?status= and Refunded onto ?type=', () => {
      expect(filterChipParam('paid')).toEqual({ status: 'success' });
      expect(filterChipParam('pending')).toEqual({ status: 'pending' });
      expect(filterChipParam('failed')).toEqual({ status: 'failed' });
      expect(filterChipParam('refunded')).toEqual({ type: 'refund' });
      expect(filterChipParam('all')).toEqual({});
    });
  });

  describe('recentWindow', () => {
    it('passes a ≤31-day range through uncapped', () => {
      expect(recentWindow({ preset: 'this-month', from: '2026-06-01', to: '2026-06-30' })).toEqual({
        from: '2026-06-01',
        to: '2026-06-30',
        capped: false,
      });
    });

    it('clamps a longer range to the most recent 31 days', () => {
      const w = recentWindow({ preset: 'this-year', from: '2026-01-01', to: '2026-12-31' });
      expect(w.capped).toBeTrue();
      expect(w.to).toBe('2026-12-31');
      expect(w.from).toBe('2026-11-30'); // 31 days before to
    });
  });
});
