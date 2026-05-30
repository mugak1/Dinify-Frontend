import { applyMenuSort, SORT_MODES, SortMode } from './menu-sort';

interface TestItem {
  id: string;
  name?: string | null;
  primary_price?: unknown;
  listing_position?: unknown;
}

describe('applyMenuSort', () => {
  describe("'a-z'", () => {
    it('sorts by name ascending', () => {
      const items: TestItem[] = [
        { id: 'c', name: 'Cake' },
        { id: 'a', name: 'Apple' },
        { id: 'b', name: 'Banana' },
      ];
      expect(applyMenuSort(items, 'a-z').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('is case-insensitive (sensitivity: base) and stable for equal names', () => {
      const items: TestItem[] = [
        { id: 'b', name: 'banana' },
        { id: 'A', name: 'Apple' },
        { id: 'a', name: 'apple' },
      ];
      // 'Apple' and 'apple' compare equal under sensitivity:'base', so a stable
      // sort keeps their input order (A before a), both ahead of 'banana'.
      expect(applyMenuSort(items, 'a-z').map((i) => i.id)).toEqual(['A', 'a', 'b']);
    });

    it('treats null/undefined names as empty string (sorted first)', () => {
      const items: TestItem[] = [
        { id: 'b', name: 'Beef' },
        { id: 'n', name: null },
        { id: 'a', name: 'Apple' },
      ];
      expect(applyMenuSort(items, 'a-z').map((i) => i.id)).toEqual(['n', 'a', 'b']);
    });

    it('does not throw on a missing name', () => {
      const items: TestItem[] = [{ id: 'x' }, { id: 'y', name: 'Y' }];
      expect(() => applyMenuSort(items, 'a-z')).not.toThrow();
    });
  });

  describe("'price-low'", () => {
    it('sorts by primary_price ascending', () => {
      const items: TestItem[] = [
        { id: 'c', primary_price: 30 },
        { id: 'a', primary_price: 10 },
        { id: 'b', primary_price: 20 },
      ];
      expect(applyMenuSort(items, 'price-low').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('coerces string prices via Number', () => {
      const items: TestItem[] = [
        { id: 'c', primary_price: '30000' },
        { id: 'a', primary_price: '5000' },
        { id: 'b', primary_price: '12000' },
      ];
      expect(applyMenuSort(items, 'price-low').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('treats null / non-numeric / missing price as 0', () => {
      const items: TestItem[] = [
        { id: 'p', primary_price: 100 },
        { id: 'n', primary_price: null },
        { id: 'x' },
      ];
      // null → 0 and missing → 0, both ahead of 100 in stable input order.
      expect(applyMenuSort(items, 'price-low').map((i) => i.id)).toEqual(['n', 'x', 'p']);
    });
  });

  describe("'price-high'", () => {
    it('sorts by primary_price descending', () => {
      const items: TestItem[] = [
        { id: 'a', primary_price: 10 },
        { id: 'c', primary_price: 30 },
        { id: 'b', primary_price: 20 },
      ];
      expect(applyMenuSort(items, 'price-high').map((i) => i.id)).toEqual(['c', 'b', 'a']);
    });

    it('coerces string prices via Number', () => {
      const items: TestItem[] = [
        { id: 'a', primary_price: '5000' },
        { id: 'c', primary_price: '30000' },
        { id: 'b', primary_price: '12000' },
      ];
      expect(applyMenuSort(items, 'price-high').map((i) => i.id)).toEqual(['c', 'b', 'a']);
    });
  });

  describe("'manual'", () => {
    it('orders by listing_position ascending', () => {
      const items: TestItem[] = [
        { id: 'c', listing_position: 3 },
        { id: 'a', listing_position: 1 },
        { id: 'b', listing_position: 2 },
      ];
      expect(applyMenuSort(items, 'manual').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('coerces string listing_position via Number', () => {
      const items: TestItem[] = [
        { id: 'c', listing_position: '3' },
        { id: 'a', listing_position: '1' },
        { id: 'b', listing_position: '2' },
      ];
      expect(applyMenuSort(items, 'manual').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });

    it('treats missing listing_position as 0', () => {
      const items: TestItem[] = [
        { id: 'b', listing_position: 5 },
        { id: 'x' },
        { id: 'a', listing_position: 1 },
      ];
      expect(applyMenuSort(items, 'manual').map((i) => i.id)).toEqual(['x', 'a', 'b']);
    });

    it('falls back to listing_position order for an unknown mode (default branch)', () => {
      const items: TestItem[] = [
        { id: 'c', listing_position: 3 },
        { id: 'a', listing_position: 1 },
        { id: 'b', listing_position: 2 },
      ];
      const unknownMode = 'bogus' as unknown as SortMode;
      expect(applyMenuSort(items, unknownMode).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('non-mutating', () => {
    it('does not change the input array order', () => {
      const items: TestItem[] = [
        { id: 'c', name: 'Cake', primary_price: 30, listing_position: 3 },
        { id: 'a', name: 'Apple', primary_price: 10, listing_position: 1 },
        { id: 'b', name: 'Banana', primary_price: 20, listing_position: 2 },
      ];
      const snapshot = items.map((i) => i.id);
      applyMenuSort(items, 'a-z');
      applyMenuSort(items, 'price-high');
      applyMenuSort(items, 'manual');
      expect(items.map((i) => i.id)).toEqual(snapshot);
    });

    it('returns a new array instance', () => {
      const items: TestItem[] = [{ id: 'a', name: 'A' }];
      expect(applyMenuSort(items, 'a-z')).not.toBe(items);
    });

    it('returns [] for an empty input', () => {
      expect(applyMenuSort([], 'a-z')).toEqual([]);
    });
  });

  it('SORT_MODES lists exactly the four supported modes', () => {
    expect(SORT_MODES).toEqual(['manual', 'a-z', 'price-low', 'price-high']);
  });
});
