import { PRESET_LABELS, formatRangeSpan, formatRangeSummary } from './range-label';

describe('range-label', () => {
  describe('PRESET_LABELS', () => {
    it('labels every preset', () => {
      expect(PRESET_LABELS['today']).toBe('Today');
      expect(PRESET_LABELS['this-week']).toBe('This week');
      expect(PRESET_LABELS['this-month']).toBe('This month');
      expect(PRESET_LABELS['custom']).toBe('Custom');
    });
  });

  describe('formatRangeSpan (collapsing)', () => {
    it('renders a single day', () => {
      expect(formatRangeSpan('2026-06-01', '2026-06-01')).toBe('1 Jun 2026');
    });

    it('collapses a same-month range to one month/year', () => {
      // en dash, no surrounding spaces
      expect(formatRangeSpan('2026-06-01', '2026-06-30')).toBe('1–30 Jun 2026');
    });

    it('keeps both months but one year within a year', () => {
      expect(formatRangeSpan('2026-05-28', '2026-06-03')).toBe('28 May – 3 Jun 2026');
    });

    it('shows both years across a year boundary', () => {
      expect(formatRangeSpan('2025-06-01', '2026-01-02')).toBe('1 Jun 2025 – 2 Jan 2026');
    });
  });

  describe('formatRangeSummary (non-collapsing)', () => {
    it('renders a single day', () => {
      expect(formatRangeSummary('2026-06-01', '2026-06-01')).toBe('1 Jun 2026');
    });

    it('repeats the month within a year', () => {
      expect(formatRangeSummary('2026-06-01', '2026-06-30')).toBe('1 Jun – 30 Jun 2026');
    });

    it('shows both years across a year boundary', () => {
      expect(formatRangeSummary('2025-06-01', '2026-01-02')).toBe('1 Jun 2025 – 2 Jan 2026');
    });
  });
});
