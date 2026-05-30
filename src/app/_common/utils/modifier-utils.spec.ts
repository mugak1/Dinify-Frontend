import { parseModifierGroups, selectionConstraintPhrase } from './modifier-utils';

describe('selectionConstraintPhrase', () => {
  it('required single → "Select 1"', () => {
    expect(selectionConstraintPhrase(1, 1)).toBe('Select 1');
  });

  it('exactly N → "Select 2"', () => {
    expect(selectionConstraintPhrase(2, 2)).toBe('Select 2');
  });

  it('range → "Select 2–5" with an en dash', () => {
    expect(selectionConstraintPhrase(2, 5)).toBe('Select 2–5');
  });

  it('optional multi → "Select up to 3"', () => {
    expect(selectionConstraintPhrase(0, 3)).toBe('Select up to 3');
  });

  it('optional single → "Select up to 1"', () => {
    expect(selectionConstraintPhrase(0, 1)).toBe('Select up to 1');
  });

  it('no ceiling (min 0, max 0) → empty string (no count line)', () => {
    expect(selectionConstraintPhrase(0, 0)).toBe('');
  });

  it('honours a custom verb', () => {
    expect(selectionConstraintPhrase(2, 2, 'Choose')).toBe('Choose 2');
  });
});

describe('parseModifierGroups normalisation', () => {
  const choice = (id: string, available = true) => ({
    id,
    name: id,
    additionalCost: 0,
    available,
  });

  function grouped(group: any) {
    return { hasModifiers: true, groups: [group] };
  }

  it('coerces a stringy maxSelections to a number', () => {
    const [g] = parseModifierGroups(
      grouped({
        id: 'g1',
        name: 'Sauce',
        selectionType: 'multiple',
        minSelections: 0,
        maxSelections: '3',
        choices: [choice('a'), choice('b'), choice('c')],
      }),
    );
    expect(g.maxSelections).toBe(3);
    expect(typeof g.maxSelections).toBe('number');
  });

  it('defaults a missing maxSelections to the available-choice count', () => {
    const [g] = parseModifierGroups(
      grouped({
        id: 'g1',
        name: 'Sauce',
        selectionType: 'multiple',
        minSelections: 0,
        choices: [choice('a'), choice('b'), choice('unavail', false)],
      }),
    );
    // 'unavail' is filtered out, leaving 2 available choices.
    expect(g.choices.length).toBe(2);
    expect(g.maxSelections).toBe(2);
  });

  it('clamps single-select to min ≤ 1 and forces max = 1', () => {
    const [g] = parseModifierGroups(
      grouped({
        id: 'g1',
        name: 'Size',
        selectionType: 'single',
        minSelections: 3,
        maxSelections: 5,
        choices: [choice('s'), choice('m'), choice('l')],
      }),
    );
    expect(g.selectionType).toBe('single');
    expect(g.minSelections).toBe(1);
    expect(g.maxSelections).toBe(1);
  });

  it('normalises legacy "multi" to "multiple"', () => {
    const [g] = parseModifierGroups(
      grouped({
        id: 'g1',
        name: 'Toppings',
        selectionType: 'multi',
        minSelections: 1,
        maxSelections: 2,
        choices: [choice('a'), choice('b')],
      }),
    );
    expect(g.selectionType).toBe('multiple');
  });

  it('derives required from minSelections, ignoring the raw flag', () => {
    const [optional] = parseModifierGroups(
      grouped({
        id: 'g1',
        name: 'X',
        selectionType: 'multiple',
        required: true, // raw flag claims required…
        minSelections: 0, // …but min 0 wins → optional
        maxSelections: 2,
        choices: [choice('a'), choice('b')],
      }),
    );
    expect(optional.required).toBe(false);

    const [required] = parseModifierGroups(
      grouped({
        id: 'g2',
        name: 'Y',
        selectionType: 'multiple',
        required: false, // raw flag claims optional…
        minSelections: 2, // …but min 2 wins → required
        maxSelections: 3,
        choices: [choice('a'), choice('b'), choice('c')],
      }),
    );
    expect(required.required).toBe(true);
  });

  it('floors a negative/NaN minSelections to 0', () => {
    const [g] = parseModifierGroups(
      grouped({
        id: 'g1',
        name: 'X',
        selectionType: 'multiple',
        minSelections: 'oops',
        maxSelections: 2,
        choices: [choice('a'), choice('b')],
      }),
    );
    expect(g.minSelections).toBe(0);
    expect(g.required).toBe(false);
  });
});
