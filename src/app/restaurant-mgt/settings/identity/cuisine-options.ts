/**
 * Curated cuisine options for the Identity section's chip-picker. This is a
 * deliberate frontend constant (not free text): selected chips populate the
 * restaurant's `cuisine_types` JSON list. Keep the list short and broad —
 * tuned for Uganda / East African mobile-money-first markets.
 *
 * Values are stored verbatim in `cuisine_types`, so editing a label here will
 * orphan any restaurant that already saved the old spelling. Prefer appending
 * over renaming.
 */
export const CUISINE_OPTIONS: readonly string[] = [
  'Café',
  'Coffee',
  'Bakery',
  'Ugandan / Local',
  'East African',
  'Continental',
  'Fast food',
  'Grill / BBQ',
  'Indian',
  'Chinese',
  'Italian / Pizza',
  'Lebanese / Middle Eastern',
  'Seafood',
  'Vegetarian',
];
