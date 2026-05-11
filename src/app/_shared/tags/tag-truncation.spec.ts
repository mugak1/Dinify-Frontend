import { splitTagsForCard, TagCardSplittable } from './tag-truncation';
import { TagCategory } from './tag-palette';

interface TestTag extends TagCardSplittable {
  id: string;
  category: TagCategory;
  display_order?: number;
}

function tag(
  id: string,
  category: TagCategory,
  display_order?: number,
): TestTag {
  return { id, category, display_order };
}

describe('splitTagsForCard', () => {
  it('returns no tags and zero hidden when given an empty array', () => {
    const result = splitTagsForCard<TestTag>([]);
    expect(result.visible).toEqual([]);
    expect(result.hiddenCount).toBe(0);
  });

  it('tolerates null and undefined inputs', () => {
    expect(splitTagsForCard<TestTag>(null)).toEqual({ visible: [], hiddenCount: 0 });
    expect(splitTagsForCard<TestTag>(undefined)).toEqual({ visible: [], hiddenCount: 0 });
  });

  it('returns 1-2 allergen-only tags unchanged with no overflow', () => {
    const tags = [tag('a1', 'allergen', 1), tag('a2', 'allergen', 2)];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['a1', 'a2']);
    expect(result.hiddenCount).toBe(0);
  });

  it('returns 1-2 non-allergen-only tags unchanged with no overflow', () => {
    const tags = [tag('d1', 'dietary', 1), tag('x1', 'descriptor', 2)];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['d1', 'x1']);
    expect(result.hiddenCount).toBe(0);
  });

  it('renders 1 allergen + 3 non-allergens as allergen, 2 non-allergens, +1', () => {
    const tags = [
      tag('a1', 'allergen', 1),
      tag('d1', 'dietary', 1),
      tag('d2', 'dietary', 2),
      tag('x1', 'descriptor', 3),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['a1', 'd1', 'd2']);
    expect(result.hiddenCount).toBe(1);
  });

  it('renders 2 allergens + 5 non-allergens as both allergens, 2 non-allergens, +3', () => {
    const tags = [
      tag('a1', 'allergen', 1),
      tag('a2', 'allergen', 2),
      tag('d1', 'dietary', 1),
      tag('d2', 'dietary', 2),
      tag('d3', 'dietary', 3),
      tag('x1', 'descriptor', 4),
      tag('x2', 'descriptor', 5),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['a1', 'a2', 'd1', 'd2']);
    expect(result.hiddenCount).toBe(3);
  });

  it('renders 6 non-allergens with 0 allergens as 2 non-allergens, +4', () => {
    const tags = [
      tag('d1', 'dietary', 1),
      tag('d2', 'dietary', 2),
      tag('d3', 'dietary', 3),
      tag('x1', 'descriptor', 4),
      tag('x2', 'descriptor', 5),
      tag('x3', 'descriptor', 6),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['d1', 'd2']);
    expect(result.hiddenCount).toBe(4);
  });

  it('puts allergens visually first even when their display_order is higher', () => {
    const tags = [
      tag('d1', 'dietary', 1),
      tag('x1', 'descriptor', 2),
      tag('a1', 'allergen', 99),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['a1', 'd1', 'x1']);
    expect(result.hiddenCount).toBe(0);
  });

  it('orders within each group by display_order ascending', () => {
    const tags = [
      tag('a-late', 'allergen', 10),
      tag('a-early', 'allergen', 1),
      tag('d-mid', 'dietary', 5),
      tag('d-early', 'dietary', 1),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual([
      'a-early',
      'a-late',
      'd-early',
      'd-mid',
    ]);
    expect(result.hiddenCount).toBe(0);
  });

  it('does not interleave allergens and non-allergens by global display_order', () => {
    const tags = [
      tag('d1', 'dietary', 1),
      tag('a1', 'allergen', 5),
      tag('d2', 'dietary', 2),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['a1', 'd1', 'd2']);
    expect(result.hiddenCount).toBe(0);
  });

  it('preserves input order when display_order is missing', () => {
    const tags = [
      tag('d-first', 'dietary'),
      tag('x-second', 'descriptor'),
      tag('d-third', 'dietary'),
    ];
    const result = splitTagsForCard(tags);
    expect(result.visible.map((t) => t.id)).toEqual(['d-first', 'x-second']);
    expect(result.hiddenCount).toBe(1);
  });

  it('does not mutate the input array', () => {
    const tags = [
      tag('d1', 'dietary', 2),
      tag('a1', 'allergen', 1),
      tag('d2', 'dietary', 1),
    ];
    const original = tags.map((t) => t.id);
    splitTagsForCard(tags);
    expect(tags.map((t) => t.id)).toEqual(original);
  });
});
