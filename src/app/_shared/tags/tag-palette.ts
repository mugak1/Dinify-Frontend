/**
 * Single source of truth for the tag colour palette and icon catalog used
 * across the Preset Tags settings page, the menu item editor, the diner
 * card renderer, and the diner filter sheet.
 *
 * Subsequent PRs (item editor tag selector, diner card rendering, diner
 * filter sheet) import from this file — keep the public shape stable and
 * fully typed.
 */

export type TagColour =
  | 'gray'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'green'
  | 'emerald'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'rose';

export interface TagColourSwatch {
  name: TagColour;
  label: string;
  /** Tailwind class pair applied to the pill background and text. */
  classes: string;
  /** Tailwind class for the colour swatch dot in the picker. */
  swatchClass: string;
}

export const TAG_COLOUR_PALETTE: readonly TagColourSwatch[] = [
  { name: 'gray',    label: 'Gray',    classes: 'bg-gray-100 text-gray-700',       swatchClass: 'bg-gray-400' },
  { name: 'red',     label: 'Red',     classes: 'bg-red-100 text-red-700',         swatchClass: 'bg-red-500' },
  { name: 'orange',  label: 'Orange',  classes: 'bg-orange-100 text-orange-700',   swatchClass: 'bg-orange-500' },
  { name: 'amber',   label: 'Amber',   classes: 'bg-amber-100 text-amber-700',     swatchClass: 'bg-amber-500' },
  { name: 'yellow',  label: 'Yellow',  classes: 'bg-yellow-100 text-yellow-700',   swatchClass: 'bg-yellow-500' },
  { name: 'green',   label: 'Green',   classes: 'bg-green-100 text-green-700',     swatchClass: 'bg-green-500' },
  { name: 'emerald', label: 'Emerald', classes: 'bg-emerald-100 text-emerald-700', swatchClass: 'bg-emerald-500' },
  { name: 'cyan',    label: 'Cyan',    classes: 'bg-cyan-100 text-cyan-700',       swatchClass: 'bg-cyan-500' },
  { name: 'blue',    label: 'Blue',    classes: 'bg-blue-100 text-blue-700',       swatchClass: 'bg-blue-500' },
  { name: 'purple',  label: 'Purple',  classes: 'bg-purple-100 text-purple-700',   swatchClass: 'bg-purple-500' },
  { name: 'rose',    label: 'Rose',    classes: 'bg-rose-100 text-rose-700',       swatchClass: 'bg-rose-500' },
];

const PALETTE_BY_NAME: Record<TagColour, TagColourSwatch> =
  TAG_COLOUR_PALETTE.reduce((acc, swatch) => {
    acc[swatch.name] = swatch;
    return acc;
  }, {} as Record<TagColour, TagColourSwatch>);

export function getTagColourClasses(colour: TagColour | string | null | undefined): string {
  if (!colour) return PALETTE_BY_NAME.gray.classes;
  return PALETTE_BY_NAME[colour as TagColour]?.classes ?? PALETTE_BY_NAME.gray.classes;
}

export function getTagColourSwatch(colour: TagColour | string | null | undefined): TagColourSwatch {
  if (!colour) return PALETTE_BY_NAME.gray;
  return PALETTE_BY_NAME[colour as TagColour] ?? PALETTE_BY_NAME.gray;
}

export function isTagColour(value: unknown): value is TagColour {
  return typeof value === 'string' && value in PALETTE_BY_NAME;
}

/**
 * Curated Lucide icon catalog — 30 food/dietary icons available to all
 * tags. SVG markup is inlined (no lucide-angular dependency per project
 * Angular rules). Each icon is 16x16, currentColor, stroke 2.
 */
export interface TagIcon {
  name: string;
  label: string;
  svg: string;
}

const I = (path: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const TAG_ICONS: readonly TagIcon[] = [
  { name: 'leaf',       label: 'Leaf',        svg: I('<path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 1 8-1 3.5-3.5 5-6 6.5"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>') },
  { name: 'sprout',     label: 'Sprout',      svg: I('<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>') },
  { name: 'wheat',      label: 'Wheat',       svg: I('<path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/><path d="M14.5 13.5 16 12l1.53 1.53a3.5 3.5 0 0 1 0 4.94L16 20l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/><path d="M18.5 9.5 20 8l1.53 1.53a3.5 3.5 0 0 1 0 4.94L20 16l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/>') },
  { name: 'wheat-off',  label: 'Wheat-off',   svg: I('<path d="m2 22 10-10"/><path d="m16 8-1.17 1.17"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/><path d="m8 8-.53.53a3.5 3.5 0 0 0 0 4.94L9 15l1.53-1.53c.55-.55.88-1.25.98-1.97"/><path d="M10.91 5.26c.15-.72.5-1.4 1.06-1.97L13.5 1.76l1.53 1.53a3.5 3.5 0 0 1 .97 1.78"/><path d="M13.5 5.5 15 7"/><path d="M14.5 13.5 16 12l1.53 1.53a3.5 3.5 0 0 1 0 4.94L16 20l-1.53-1.53a3.5 3.5 0 0 1 0-4.94z"/><path d="m2 2 20 20"/>') },
  { name: 'milk',       label: 'Milk',        svg: I('<path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2"/><path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/>') },
  { name: 'milk-off',   label: 'Milk-off',    svg: I('<path d="M8 2h8"/><path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V18a4 4 0 0 0 4 4h2a4 4 0 0 0 4-4v-4.5"/><path d="M15 2v2.789a4 4 0 0 0 .672 2.219l.656.984a4 4 0 0 1 .161.24"/><path d="m2 2 20 20"/>') },
  { name: 'nut',        label: 'Nut',         svg: I('<path d="M12 4V2"/><path d="M5 10v4a7.004 7.004 0 0 0 5.277 6.787c.412.104.802.292 1.102.592L12 22l.621-.621c.3-.3.69-.488 1.102-.592A7.003 7.003 0 0 0 19 14v-4"/><path d="M12 4C8 4 4.5 6 4 8c-.243.97-.919 1.952-2 3 1.31-.082 1.972-.998 3-1 1 0 2 1 2 3"/><path d="M12 4c4 0 7.5 2 8 4 .243.97.919 1.952 2 3-1.31-.082-1.972-.998-3-1-1 0-2 1-2 3"/>') },
  { name: 'egg',        label: 'Egg',         svg: I('<path d="M12 22c6.23-.05 7.87-5.57 7.5-10-.36-4.34-3.95-9.96-7.5-10-3.55.04-7.14 5.66-7.5 10-.37 4.43 1.27 9.95 7.5 10z"/>') },
  { name: 'fish',       label: 'Fish',        svg: I('<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6-3.56 0-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5 .23 6.5C5.58 18.03 7 16 7 13.33"/>') },
  { name: 'shell',      label: 'Shell',       svg: I('<path d="M14 11a2 2 0 1 1-4 0 4 4 0 0 1 8 0 6 6 0 0 1-12 0 8 8 0 0 1 16 0 10 10 0 1 1-20 0 11.93 11.93 0 0 1 2.42-7.22 2 2 0 1 1 3.16 2.44"/>') },
  { name: 'bean',       label: 'Bean',        svg: I('<path d="M10.165 6.598C9.954 7.478 9.494 8.473 8.5 9.5c-1.5 1.5-3 2.5-3 6 0 2.514 2.557 4.5 6 4.5 4 0 7-2.5 7-7s-3-7.5-7-7.5c-1.84 0-3.087.785-3.835 1.598z"/><path d="M5.341 10.62a4 4 0 1 0 5.279-5.28"/>') },
  { name: 'beef',       label: 'Beef',        svg: I('<circle cx="12.5" cy="8.5" r="2.5"/><path d="M12.5 2a6.5 6.5 0 0 0-6.22 4.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3A6.5 6.5 0 0 0 12.5 2z"/><path d="m18.5 6 2.19 4.5a6.48 6.48 0 0 1 .31 2 6.49 6.49 0 0 1-2.6 5.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5"/>') },
  { name: 'drumstick',  label: 'Drumstick',   svg: I('<path d="M15.45 15.4c-2.13.65-4.3.32-5.7-1.1-2.29-2.27-1.76-6.5 1.17-9.42 2.93-2.93 7.15-3.46 9.43-1.18 1.41 1.41 1.74 3.57 1.1 5.71-1.4-.51-3.26-.02-4.64 1.36-1.38 1.38-1.87 3.23-1.36 4.63z"/><path d="m11.25 15.6-2.16 2.16a2.5 2.5 0 1 1-4.56 1.73 2.49 2.49 0 0 1-1.41-4.24 2.5 2.5 0 0 1 4.24-1.41l2.16-2.16"/>') },
  { name: 'apple',      label: 'Apple',       svg: I('<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/>') },
  { name: 'banana',     label: 'Banana',      svg: I('<path d="M4 13c3.5-2 8-2 10 2a5.5 5.5 0 0 1 8 5"/><path d="M5.15 17.89c5.52-1.52 8.65-6.89 7-12C11.55 4 11.5 2 13 2c3.22 0 5 5.5 5 8 0 6.5-4.2 12-10.49 12C5.55 22 2 22 2 20c0-1.5 1.14-1.55 3.15-2.11Z"/>') },
  { name: 'carrot',     label: 'Carrot',      svg: I('<path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46"/><path d="M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z"/><path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z"/>') },
  { name: 'coffee',     label: 'Coffee',      svg: I('<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>') },
  { name: 'cookie',     label: 'Cookie',      svg: I('<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/>') },
  { name: 'salad',      label: 'Salad',       svg: I('<path d="M7 21h10"/><path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1"/><path d="m13 12 4-4"/><path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2"/>') },
  { name: 'ice-cream',  label: 'Ice cream',   svg: I('<path d="m7 11 4.08 10.35a1 1 0 0 0 1.84 0L17 11"/><path d="M17 7A5 5 0 0 0 7 7"/><path d="M17 7a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4"/>') },
  { name: 'soup',       label: 'Soup',        svg: I('<path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M7 21h10"/><path d="M19.5 12 22 6"/><path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62"/><path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62"/><path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62"/>') },
  { name: 'sandwich',   label: 'Sandwich',    svg: I('<path d="M3 11v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3"/><path d="M12 19H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3.83"/><path d="m3 11 7.77-6.04a2 2 0 0 1 2.46 0L21 11H3Z"/>') },
  { name: 'pizza',      label: 'Pizza',       svg: I('<path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="m2 16 20 6-6-20A20 20 0 0 0 2 16"/><path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4"/>') },
  { name: 'croissant',  label: 'Croissant',   svg: I('<path d="m4.6 13.11 5.79-3.21c1.89-1.05 4.79 1.78 3.71 3.71l-3.22 5.81C8.8 23.16.79 15.23 4.6 13.11Z"/><path d="m10.5 9.5-1-2.29C9.2 6.48 8.8 6 8 6H4.5C2.79 6 2 6.5 2 8.5a7.71 7.71 0 0 0 2 4.83"/><path d="M8 6c0-1.55.24-4-2-4-2 0-2.5 2.17-2.5 4"/><path d="m14.5 13.5 2.29 1c.73.3 1.21.7 1.21 1.5v3.5c0 1.71-.5 2.5-2.5 2.5a7.71 7.71 0 0 1-4.83-2"/><path d="M18 16c1.55 0 4-.24 4 2 0 2-2.17 2.5-4 2.5"/>') },
  { name: 'popcorn',    label: 'Popcorn',     svg: I('<path d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0 0 4"/><path d="M10 22 9 8"/><path d="m14 22 1-14"/><path d="M20 8c.5 0 .9.4.8 1l-2.6 12c-.1.5-.7 1-1.2 1H7c-.6 0-1.1-.4-1.2-1L3.2 9c-.1-.6.3-1 .8-1Z"/>') },
  { name: 'dessert',    label: 'Dessert',     svg: I('<circle cx="12" cy="4" r="2"/><path d="M10.2 3.2C5.5 4 2 8.1 2 13a2 2 0 0 0 4 0v-1a2 2 0 0 1 4 0v4a2 2 0 0 0 4 0v-4a2 2 0 0 1 4 0v1a2 2 0 0 0 4 0c0-4.9-3.5-9-8.2-9.8"/><path d="M3.2 14.8a9 9 0 0 0 17.6 0"/>') },
  { name: 'flame',      label: 'Flame',       svg: I('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>') },
  { name: 'snowflake',  label: 'Snowflake',   svg: I('<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>') },
  { name: 'award',      label: 'Award',       svg: I('<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>') },
  { name: 'moon-star',  label: 'Moon-star',   svg: I('<path d="M12 3a6.364 6.364 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M20 3v4"/><path d="M22 5h-4"/>') },
];

const ICON_BY_NAME: Record<string, TagIcon> = TAG_ICONS.reduce((acc, icon) => {
  acc[icon.name] = icon;
  return acc;
}, {} as Record<string, TagIcon>);

export function getTagIconSvg(name: string | null | undefined): string {
  if (!name) return '';
  return ICON_BY_NAME[name]?.svg ?? '';
}

export function getTagIcon(name: string | null | undefined): TagIcon | null {
  if (!name) return null;
  return ICON_BY_NAME[name] ?? null;
}

export type TagCategory = 'allergen' | 'dietary' | 'descriptor';

export interface TagCategoryDescriptor {
  value: TagCategory;
  label: string;
  helpText: string;
}

export const TAG_CATEGORIES: readonly TagCategoryDescriptor[] = [
  {
    value: 'allergen',
    label: 'Allergen',
    helpText: 'Allergen tags always show on menu cards for safety.',
  },
  {
    value: 'dietary',
    label: 'Dietary',
    helpText: 'Dietary tags help diners spot suitable options at a glance.',
  },
  {
    value: 'descriptor',
    label: 'Descriptor',
    helpText: 'Descriptor tags are short marketing labels — e.g. "Spicy" or "Chef\'s pick".',
  },
];
