import { ModifierGroup } from 'src/app/_models/app.models';

/**
 * Parses a MenuItem.options value (the grouped format saved by the portal)
 * into a normalized ModifierGroup[] array, filtering out unavailable choices.
 * Returns [] for any shape that isn't grouped — grouped is the only supported format.
 */
export function parseModifierGroups(options: any): ModifierGroup[] {
  if (!options) return [];
  let parsed = options;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  if (!parsed || !parsed.hasModifiers || !Array.isArray(parsed.groups)) return [];
  return parsed.groups.map((g: any) => {
    const choices = (g.choices || []).filter((c: any) => c.available !== false);

    // Only an explicit 'single' stays single; everything else (including the
    // legacy 'multi' value) normalises to 'multiple'.
    const selectionType: 'single' | 'multiple' =
      g.selectionType === 'single' ? 'single' : 'multiple';

    // minSelections → non-negative integer (default 0 when missing/NaN).
    let minSelections = Math.floor(Number(g.minSelections));
    if (!Number.isFinite(minSelections) || minSelections < 0) minSelections = 0;

    // maxSelections → positive integer; fall back to the number of available
    // choices when missing/NaN/<1.
    let maxSelections = Math.floor(Number(g.maxSelections));
    if (!Number.isFinite(maxSelections) || maxSelections < 1) maxSelections = choices.length;

    // Single-select can require at most one and allows exactly one.
    if (selectionType === 'single') {
      minSelections = Math.min(minSelections, 1);
      maxSelections = 1;
    }

    // Never let the cap fall below the floor.
    if (maxSelections < minSelections) maxSelections = minSelections;

    return {
      ...g,
      selectionType,
      minSelections,
      maxSelections,
      // Single source of truth: the Required/Optional badge and the validation
      // gate both read this, so they can never disagree.
      required: minSelections > 0,
      choices,
    };
  });
}

/** Count phrase for a selection requirement (the Required/Optional pill is
 *  rendered separately). Empty string means render no count line. */
export function selectionConstraintPhrase(min: number, max: number, verb = 'Select'): string {
  const lo = Math.max(0, Math.floor(min || 0));
  const hi = Math.max(lo, Math.floor(max || 0));
  if (lo > 0 && lo === hi) return `${verb} ${lo}`;            // exactly N (required)
  if (lo > 0 && lo < hi)   return `${verb} ${lo}–${hi}`; // N-M range (required)
  if (lo === 0 && hi > 1)  return `up to ${hi}`;              // optional, up to M
  return '';                                                  // optional single / nothing to state
}
