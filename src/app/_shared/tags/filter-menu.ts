import { TagCategory } from './tag-palette';

/**
 * Identifier of a tag — both `MenuItemTagRef` and `RestaurantTag` use
 * a UUID string for `id`. The filter sheet keys everything off the id
 * because diners may have multiple tags with overlapping display names
 * across a restaurant's catalog.
 */
export type TagId = string;

/**
 * Minimum tag-ref shape required for filtering. Matches `MenuItemTagRef`
 * and any compatible row (e.g. a `RestaurantTag` from the catalog).
 */
export interface FilterableTagRef {
  id: TagId;
  category: TagCategory;
}

/**
 * Minimum item shape required for filtering — anything carrying a
 * `tags` array of refs. The diner menu uses `MenuItem`; tests pass a
 * minimal stand-in.
 */
export interface FilterableMenuItem {
  tags?: readonly FilterableTagRef[] | null;
}

/**
 * Applies the diner-side tag filter rules:
 *
 *   - `selectedDietary` is a positive AND filter. An item matches only
 *     if its tags include EVERY selected dietary tag id. Selecting
 *     "Vegetarian" + "Gluten-Free" yields items that are both.
 *
 *   - `selectedAllergens` is a negative ANY filter. An item is hidden
 *     if any of its tags match ANY selected allergen tag id. Selecting
 *     "Contains Gluten" + "Contains Dairy" hides items with either.
 *
 *   - When both lists have selections, an item must satisfy the dietary
 *     AND the allergen criteria.
 *
 *   - Empty selection lists are no-ops on their dimension. With both
 *     empty, every input item passes through.
 *
 * Tag ids — not names — are the comparison key throughout, because a
 * restaurant may have several tags with similar names (e.g. a custom
 * "Vegetarian" alongside a preset one) and we must not conflate them.
 *
 * Pure / read-only — does not mutate the input array, and returns a
 * new array (a stable shallow copy when nothing is filtered).
 */
export function filterMenuItems<T extends FilterableMenuItem>(
  items: readonly T[] | null | undefined,
  selectedDietary: readonly TagId[],
  selectedAllergens: readonly TagId[],
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const hasDietary = selectedDietary.length > 0;
  const hasAllergens = selectedAllergens.length > 0;
  if (!hasDietary && !hasAllergens) return items.slice();

  const dietarySet = new Set(selectedDietary);
  const allergenSet = new Set(selectedAllergens);

  return items.filter((item) => {
    const tagIds = new Set<TagId>();
    for (const t of item.tags ?? []) {
      if (t?.id) tagIds.add(t.id);
    }

    if (hasDietary) {
      for (const id of dietarySet) {
        if (!tagIds.has(id)) return false;
      }
    }

    if (hasAllergens) {
      for (const id of tagIds) {
        if (allergenSet.has(id)) return false;
      }
    }

    return true;
  });
}
