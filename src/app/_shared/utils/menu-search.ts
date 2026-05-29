export interface SearchableMenuItem {
  name?: string | null;
  description?: string | null;
  [key: string]: any;
}

/**
 * Ranked menu search. Tier 1: the query appears in the item NAME. Tier 2: the
 * query appears in the DESCRIPTION but not the name. Within each tier the input
 * order is preserved (callers pass items in menu order). Case-insensitive
 * substring match; the query is trimmed. A blank query returns [].
 */
export function searchMenuItems<T extends SearchableMenuItem>(
  items: readonly T[] | null | undefined,
  query: string | null | undefined,
): T[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return [];
  const inName: T[] = [];
  const inDescriptionOnly: T[] = [];
  for (const item of items ?? []) {
    const name = (item?.name ?? '').toLowerCase();
    const description = (item?.description ?? '').toLowerCase();
    if (name.includes(q)) inName.push(item);
    else if (description.includes(q)) inDescriptionOnly.push(item);
  }
  return [...inName, ...inDescriptionOnly];
}

/**
 * True when the query matches the item's DESCRIPTION but not its NAME — i.e. the
 * result needs a "Contains" cue to explain why it surfaced. Same trim + casing
 * rules as searchMenuItems so the two never disagree.
 */
export function matchedDescriptionOnly(
  item: SearchableMenuItem | null | undefined,
  query: string | null | undefined,
): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return false;
  const name = (item?.name ?? '').toLowerCase();
  const description = (item?.description ?? '').toLowerCase();
  return !name.includes(q) && description.includes(q);
}
