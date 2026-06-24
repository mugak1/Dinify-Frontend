import {
  TAG_COLOUR_PALETTE,
  getTagColourClasses,
  getTagIconDiscClasses,
} from './tag-palette';

describe('tag palette (restyle treatment)', () => {
  it('defines all 11 named colours', () => {
    expect(TAG_COLOUR_PALETTE.length).toBe(11);
  });

  for (const sw of TAG_COLOUR_PALETTE) {
    describe(`colour "${sw.name}"`, () => {
      it('has a four-part pill body (soft bg + family text + inset ring)', () => {
        expect(sw.pill).toContain(`bg-${sw.name}-`);
        expect(sw.pill).toContain(`text-${sw.name}-`);
        expect(sw.pill).toContain('ring-1');
        expect(sw.pill).toContain('ring-inset');
        expect(sw.pill).toContain(`ring-${sw.name}-`);
      });

      it('has a solid icon disc with a white glyph', () => {
        expect(sw.iconDisc).toContain(`bg-${sw.name}-`);
        expect(sw.iconDisc).toContain('text-white');
      });

      it('keeps a solid picker swatch dot', () => {
        expect(sw.swatchClass).toContain(`bg-${sw.name}-`);
      });
    });
  }

  it('resolves pill-body classes by colour, falling back to neutral grey', () => {
    expect(getTagColourClasses('red')).toContain('bg-red-50');
    expect(getTagColourClasses(null)).toContain('bg-gray-50');
    // Unknown / legacy colour → neutral grey, never an unstyled pill.
    expect(getTagColourClasses('chartreuse')).toContain('bg-gray-50');
  });

  it('resolves icon-disc classes by colour, falling back to neutral grey', () => {
    expect(getTagIconDiscClasses('blue')).toContain('bg-blue-600');
    expect(getTagIconDiscClasses(undefined)).toContain('bg-gray-500');
    expect(getTagIconDiscClasses('chartreuse')).toContain('bg-gray-500');
  });

  it('uses a deeper disc step for the light amber/yellow families (white-glyph contrast)', () => {
    const amber = TAG_COLOUR_PALETTE.find((s) => s.name === 'amber')!;
    const yellow = TAG_COLOUR_PALETTE.find((s) => s.name === 'yellow')!;
    expect(amber.iconDisc).toContain('bg-amber-700');
    expect(yellow.iconDisc).toContain('bg-yellow-700');
  });
});
