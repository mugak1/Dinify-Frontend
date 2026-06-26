// Review quick-feedback chips: one-tap sentiments a diner can attach to a review.
// SUBMITTED AS STABLE KEYS ONLY (labels live on the frontend); the operator Reviews
// feed renders the stored keys back as read-only labels. Single source of truth for
// the key→label contract so a relabel updates BOTH surfaces (the diner order-complete
// screen and the operator Reviews feed) at once.
// NOTE: distinct from the dietary tag system in `_shared/tags/` (allergen/dietary
// descriptors) — do not conflate the two taxonomies.

export interface ReviewTagChip {
  /** Stable key persisted on the review and sent to the backend. */
  key: string;
  /** Human-facing label shown in the UI (frontend-only). */
  label: string;
}

/** The canonical chip set, in display order. */
export const REVIEW_TAG_CHIPS: ReadonlyArray<ReviewTagChip> = [
  { key: 'great_flavour', label: 'Great flavour' },
  { key: 'quick_service', label: 'Quick service' },
  { key: 'friendly_staff', label: 'Friendly staff' },
  { key: 'good_value', label: 'Good value' },
  { key: 'spotless', label: 'Spotless' },
];

/** key → label lookup, derived from REVIEW_TAG_CHIPS so there is no divergent copy. */
const REVIEW_TAG_LABELS: Readonly<Record<string, string>> = REVIEW_TAG_CHIPS.reduce(
  (acc, chip) => ({ ...acc, [chip.key]: chip.label }),
  {} as Record<string, string>,
);

/**
 * Display label for a stored review-tag key. A known key maps to its canonical
 * label; any unknown key is humanized (underscores → spaces, sentence-cased) so a
 * never-before-seen key still renders a clean badge instead of breaking. Returns ''
 * for empty/nullish input so callers never render a blank badge.
 */
export function reviewTagLabel(key: string | null | undefined): string {
  if (!key) return '';
  const known = REVIEW_TAG_LABELS[key];
  if (known) return known;
  const spaced = key.replace(/_/g, ' ').trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
