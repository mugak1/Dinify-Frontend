import { REVIEW_TAG_CHIPS, reviewTagLabel } from './review-tags';

describe('review-tags', () => {
  describe('REVIEW_TAG_CHIPS', () => {
    it('exposes the five canonical chips in display order', () => {
      expect(REVIEW_TAG_CHIPS.map((c) => c.key)).toEqual([
        'great_flavour',
        'quick_service',
        'friendly_staff',
        'good_value',
        'spotless',
      ]);
      expect(REVIEW_TAG_CHIPS.map((c) => c.label)).toEqual([
        'Great flavour',
        'Quick service',
        'Friendly staff',
        'Good value',
        'Spotless',
      ]);
    });
  });

  describe('reviewTagLabel', () => {
    it('maps every known key to its canonical label', () => {
      expect(reviewTagLabel('great_flavour')).toBe('Great flavour');
      expect(reviewTagLabel('quick_service')).toBe('Quick service');
      expect(reviewTagLabel('friendly_staff')).toBe('Friendly staff');
      expect(reviewTagLabel('good_value')).toBe('Good value');
      expect(reviewTagLabel('spotless')).toBe('Spotless');
    });

    it('humanizes an unknown key: underscores to spaces, sentence-cased', () => {
      expect(reviewTagLabel('not_in_map')).toBe('Not in map');
      expect(reviewTagLabel('wow')).toBe('Wow');
      expect(reviewTagLabel('LOUD_KEY')).toBe('Loud key');
    });

    it('returns an empty string for empty/nullish input (never a blank crash)', () => {
      expect(reviewTagLabel('')).toBe('');
      expect(reviewTagLabel('   ')).toBe('');
      expect(reviewTagLabel(null)).toBe('');
      expect(reviewTagLabel(undefined)).toBe('');
    });
  });
});
