import { FilterableMenuItem, filterMenuItems } from './filter-menu';
import { TagCategory } from './tag-palette';

interface TestItem extends FilterableMenuItem {
  id: string;
  tags: Array<{ id: string; category: TagCategory }>;
}

function item(id: string, tagIds: Array<[string, TagCategory]> = []): TestItem {
  return {
    id,
    tags: tagIds.map(([tid, category]) => ({ id: tid, category })),
  };
}

const VEGETARIAN = 'd-veg';
const VEGAN = 'd-vegan';
const GLUTEN_FREE = 'd-gf';
const GLUTEN = 'a-gluten';
const DAIRY = 'a-dairy';
const NUTS = 'a-nuts';

describe('filterMenuItems', () => {
  const items: TestItem[] = [
    item('plain', []),
    item('veg', [[VEGETARIAN, 'dietary']]),
    item('veg-gf', [[VEGETARIAN, 'dietary'], [GLUTEN_FREE, 'dietary']]),
    item('vegan-gf', [
      [VEGETARIAN, 'dietary'],
      [VEGAN, 'dietary'],
      [GLUTEN_FREE, 'dietary'],
    ]),
    item('veg-with-gluten', [
      [VEGETARIAN, 'dietary'],
      [GLUTEN, 'allergen'],
    ]),
    item('veg-with-nuts', [
      [VEGETARIAN, 'dietary'],
      [NUTS, 'allergen'],
    ]),
    item('contains-dairy', [[DAIRY, 'allergen']]),
  ];

  it('returns every item when no filters are selected', () => {
    const result = filterMenuItems(items, [], []);
    expect(result.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('returns a new array even when nothing is filtered', () => {
    const result = filterMenuItems(items, [], []);
    expect(result).not.toBe(items as unknown as TestItem[]);
  });

  it('returns an empty array for empty / null / undefined input', () => {
    expect(filterMenuItems([], [VEGETARIAN], [])).toEqual([]);
    expect(filterMenuItems(null, [VEGETARIAN], [])).toEqual([]);
    expect(filterMenuItems(undefined, [VEGETARIAN], [])).toEqual([]);
  });

  it('shows only items carrying every selected dietary tag (AND)', () => {
    const result = filterMenuItems(items, [VEGETARIAN], []);
    expect(result.map((i) => i.id)).toEqual([
      'veg',
      'veg-gf',
      'vegan-gf',
      'veg-with-gluten',
      'veg-with-nuts',
    ]);
  });

  it('combines multiple dietary tags as AND', () => {
    const result = filterMenuItems(items, [VEGETARIAN, GLUTEN_FREE], []);
    expect(result.map((i) => i.id)).toEqual(['veg-gf', 'vegan-gf']);
  });

  it('hides items carrying a selected allergen', () => {
    const result = filterMenuItems(items, [], [GLUTEN]);
    expect(result.map((i) => i.id)).toEqual([
      'plain',
      'veg',
      'veg-gf',
      'vegan-gf',
      'veg-with-nuts',
      'contains-dairy',
    ]);
  });

  it('combines multiple allergen tags as ANY (hide if either matches)', () => {
    const result = filterMenuItems(items, [], [GLUTEN, DAIRY]);
    expect(result.map((i) => i.id)).toEqual([
      'plain',
      'veg',
      'veg-gf',
      'vegan-gf',
      'veg-with-nuts',
    ]);
  });

  it('combines dietary AND allergen filters', () => {
    const result = filterMenuItems(items, [VEGETARIAN], [NUTS]);
    expect(result.map((i) => i.id)).toEqual([
      'veg',
      'veg-gf',
      'vegan-gf',
      'veg-with-gluten',
    ]);
  });

  it('returns empty when no item matches the combined criteria', () => {
    const result = filterMenuItems(items, [VEGAN], [GLUTEN_FREE]);
    expect(result).toEqual([]);
  });

  it('returns all input when every item matches a no-op allergen filter', () => {
    const result = filterMenuItems(items, [], ['nonexistent-allergen']);
    expect(result.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('tolerates items with missing tags arrays', () => {
    const sparse: FilterableMenuItem[] = [
      { tags: null },
      { tags: undefined },
      {},
    ];
    expect(filterMenuItems(sparse, [VEGETARIAN], [])).toEqual([]);
    expect(filterMenuItems(sparse, [], [GLUTEN])).toEqual([
      { tags: null },
      { tags: undefined },
      {},
    ]);
  });

  it('does not mutate the input array', () => {
    const original = items.map((i) => i.id);
    filterMenuItems(items, [VEGETARIAN], [GLUTEN]);
    expect(items.map((i) => i.id)).toEqual(original);
  });
});
