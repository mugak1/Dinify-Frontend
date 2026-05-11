import { TagCategory } from './tag-palette';

/**
 * Minimum shape required to split tags for card rendering. Both
 * `MenuItemTagRef` (embedded on a `MenuItem`) and `RestaurantTag` (the
 * full catalog row) satisfy it. `display_order` is optional because
 * the embedded ref does not carry it — when absent the input order is
 * preserved (Array.prototype.sort is stable in modern runtimes).
 */
export interface TagCardSplittable {
  category: TagCategory;
  display_order?: number;
}

/**
 * Maximum non-allergen tags rendered on a compact card before
 * collapsing the remainder behind a "+N" overflow indicator.
 * Allergen tags are safety-critical and never collapsed.
 */
export const CARD_NON_ALLERGEN_TAG_LIMIT = 2;

export interface TagCardSplit<T> {
  visible: T[];
  hiddenCount: number;
}

/**
 * Splits an item's tags for compact-card rendering:
 *  - all allergen tags first (never truncated — safety-critical)
 *  - then up to CARD_NON_ALLERGEN_TAG_LIMIT non-allergen tags
 *  - hiddenCount counts non-allergen tags only (allergens never count)
 *
 * Ordering inside each group is by `display_order` ascending; missing
 * values fall back to input order via stable sort. Allergens and
 * non-allergens are never interleaved.
 *
 * Pure / render-only — does not mutate the input array.
 */
export function splitTagsForCard<T extends TagCardSplittable>(
  tags: readonly T[] | null | undefined,
): TagCardSplit<T> {
  if (!Array.isArray(tags) || tags.length === 0) {
    return { visible: [], hiddenCount: 0 };
  }

  const byDisplayOrder = (a: T, b: T): number =>
    (a.display_order ?? 0) - (b.display_order ?? 0);

  const allergens = tags
    .filter((t) => t.category === 'allergen')
    .slice()
    .sort(byDisplayOrder);

  const nonAllergens = tags
    .filter((t) => t.category !== 'allergen')
    .slice()
    .sort(byDisplayOrder);

  const visibleNonAllergens = nonAllergens.slice(0, CARD_NON_ALLERGEN_TAG_LIMIT);
  const hiddenCount = Math.max(
    0,
    nonAllergens.length - CARD_NON_ALLERGEN_TAG_LIMIT,
  );

  return {
    visible: [...allergens, ...visibleNonAllergens],
    hiddenCount,
  };
}
