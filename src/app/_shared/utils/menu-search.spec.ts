import { matchedDescriptionOnly, searchMenuItems, SearchableMenuItem } from './menu-search';

interface TestItem extends SearchableMenuItem {
  id: string;
  name?: string | null;
  description?: string | null;
}

function item(id: string, name?: string | null, description?: string | null): TestItem {
  return { id, name, description };
}

describe('searchMenuItems', () => {
  const items: TestItem[] = [
    item('a', 'Beef Burger', 'Juicy grilled patty'),
    item('b', 'Chicken Wrap', 'Served with beef gravy on the side'),
    item('c', 'Veggie Bowl', 'Fresh greens and grains'),
    item('d', 'Beef Stew', 'Slow cooked'),
    item('e', 'Fruit Salad', 'A medley of seasonal beef-free fruit'),
  ];

  it('returns name matches before description-only matches', () => {
    const result = searchMenuItems(items, 'beef');
    // name matches: a, d  |  description-only matches: b, e
    expect(result.map((i) => i.id)).toEqual(['a', 'd', 'b', 'e']);
  });

  it('preserves original menu order within each tier', () => {
    const result = searchMenuItems(items, 'beef');
    const names = result.filter((i) => (i.name ?? '').toLowerCase().includes('beef'));
    expect(names.map((i) => i.id)).toEqual(['a', 'd']);
    const descOnly = result.filter((i) => !(i.name ?? '').toLowerCase().includes('beef'));
    expect(descOnly.map((i) => i.id)).toEqual(['b', 'e']);
  });

  it('lists an item matching both name and description once, in the name tier', () => {
    const both = [
      item('x', 'Spicy Tofu', 'Extra spicy and crispy'),
      item('y', 'Mild Bowl', 'A spicy kick on the side'),
    ];
    const result = searchMenuItems(both, 'spicy');
    expect(result.map((i) => i.id)).toEqual(['x', 'y']);
    // 'x' appears exactly once
    expect(result.filter((i) => i.id === 'x').length).toBe(1);
  });

  it('returns [] for a blank query', () => {
    expect(searchMenuItems(items, '')).toEqual([]);
  });

  it('returns [] for a whitespace-only query', () => {
    expect(searchMenuItems(items, '   ')).toEqual([]);
  });

  it('returns [] for null/undefined query', () => {
    expect(searchMenuItems(items, null)).toEqual([]);
    expect(searchMenuItems(items, undefined)).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(searchMenuItems(items, 'BEEF').map((i) => i.id)).toEqual(['a', 'd', 'b', 'e']);
  });

  it('does not throw on null/missing name or description', () => {
    const messy: TestItem[] = [
      item('n1', null, 'beef in description'),
      item('n2', 'Beef plain', null),
      { id: 'n3' },
    ];
    expect(() => searchMenuItems(messy, 'beef')).not.toThrow();
    expect(searchMenuItems(messy, 'beef').map((i) => i.id)).toEqual(['n2', 'n1']);
  });

  it('handles null/undefined items lists', () => {
    expect(searchMenuItems(null, 'beef')).toEqual([]);
    expect(searchMenuItems(undefined, 'beef')).toEqual([]);
  });
});

describe('matchedDescriptionOnly', () => {
  it('is true when the query matches the description but not the name', () => {
    expect(matchedDescriptionOnly(item('a', 'Chicken Wrap', 'with beef gravy'), 'beef')).toBe(true);
  });

  it('is false when the query matches the name', () => {
    expect(matchedDescriptionOnly(item('a', 'Beef Burger', 'with beef gravy'), 'beef')).toBe(false);
  });

  it('is false when the query matches neither', () => {
    expect(matchedDescriptionOnly(item('a', 'Veggie Bowl', 'fresh greens'), 'beef')).toBe(false);
  });

  it('is false for a blank/whitespace query', () => {
    expect(matchedDescriptionOnly(item('a', 'X', 'beef'), '')).toBe(false);
    expect(matchedDescriptionOnly(item('a', 'X', 'beef'), '   ')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchedDescriptionOnly(item('a', 'Chicken Wrap', 'with BEEF gravy'), 'beef')).toBe(true);
  });

  it('does not throw on null/missing fields', () => {
    expect(() => matchedDescriptionOnly(null, 'beef')).not.toThrow();
    expect(matchedDescriptionOnly({ id: 'x' }, 'beef')).toBe(false);
    expect(matchedDescriptionOnly(item('a', null, 'beef'), 'beef')).toBe(true);
  });
});
