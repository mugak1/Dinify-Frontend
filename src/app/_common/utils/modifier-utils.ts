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
  return parsed.groups.map((g: any) => ({
    ...g,
    choices: (g.choices || []).filter((c: any) => c.available !== false),
  }));
}
