/**
 * Canonical menu item sort modes and comparator, shared by the restaurant
 * portal (menu service + preview drawer) and the diner app so the two views
 * can't drift. `'manual'` means `listing_position` order — the order the
 * backend already returns.
 */
export const SORT_MODES = ['manual', 'a-z', 'price-low', 'price-high'] as const;
export type SortMode = (typeof SORT_MODES)[number];

/**
 * Returns a new array of `items` ordered for `mode`. Non-mutating — the input
 * array is copied first, so callers can pass signal/store values safely.
 */
export function applyMenuSort<
  T extends { name?: string | null; primary_price?: unknown; listing_position?: unknown },
>(items: T[], mode: SortMode): T[] {
  const arr = [...items];
  switch (mode) {
    case 'a-z':
      return arr.sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' }),
      );
    case 'price-low':
      return arr.sort((a, b) => (Number(a.primary_price) || 0) - (Number(b.primary_price) || 0));
    case 'price-high':
      return arr.sort((a, b) => (Number(b.primary_price) || 0) - (Number(a.primary_price) || 0));
    case 'manual':
    default:
      return arr.sort((a, b) => (Number(a.listing_position) || 0) - (Number(b.listing_position) || 0));
  }
}
