import contract from './checkout-limits.contract.json';
import {
  MAX_CHOICES_PER_GROUP,
  MAX_EXTRAS_PER_LINE,
  MAX_LINES_PER_ORDER,
  MAX_MODIFIER_GROUPS_PER_LINE,
  MAX_QUANTITY_PER_LINE,
  MAX_SELECTION_ENTRIES_PER_REQUEST,
  MAX_TOTAL_UNITS,
  atLineQuantityCeiling,
  checkCheckoutLimits,
} from './checkout-limits';

const line = (quantity: number, choices = 0, extras = 0) => ({
  quantity,
  selectedModifiers: choices
    ? [{ choices: Array.from({ length: choices }, (_, i) => `c${i}`) }]
    : [],
  extras: Array.from({ length: extras }, (_, i) => ({ id: `e${i}` })),
});

describe('checkout-limits', () => {
  // THE point of the fixture: the numbers are the BACKEND's. Both repositories
  // assert against this same file, so either side drifting fails its own suite
  // instead of surfacing as a rejected order.
  describe('agreement with the backend contract fixture', () => {
    it('matches every ceiling the backend published', () => {
      expect(MAX_QUANTITY_PER_LINE).toBe(contract.MAX_QUANTITY_PER_LINE);
      expect(MAX_LINES_PER_ORDER).toBe(contract.MAX_LINES_PER_ORDER);
      expect(MAX_TOTAL_UNITS).toBe(contract.MAX_TOTAL_UNITS);
      expect(MAX_MODIFIER_GROUPS_PER_LINE).toBe(contract.MAX_MODIFIER_GROUPS_PER_LINE);
      expect(MAX_CHOICES_PER_GROUP).toBe(contract.MAX_CHOICES_PER_GROUP);
      expect(MAX_EXTRAS_PER_LINE).toBe(contract.MAX_EXTRAS_PER_LINE);
      expect(MAX_SELECTION_ENTRIES_PER_REQUEST).toBe(
        contract.MAX_SELECTION_ENTRIES_PER_REQUEST,
      );
    });

    it('declares no ceiling the contract does not carry, and misses none', () => {
      const published = Object.keys(contract).filter((k) => !k.startsWith('_'));
      expect(published.length).toBe(7);
    });
  });

  describe('a basket the server would accept', () => {
    it('reports no breach for an ordinary basket', () => {
      const state = checkCheckoutLimits([line(2, 3, 1), line(1)]);
      expect(state.breach).toBeNull();
      expect(state.message).toBe('');
      expect(state.overLimitLineIndexes).toEqual([]);
    });

    it('reports no breach for an empty basket', () => {
      expect(checkCheckoutLimits([]).breach).toBeNull();
    });

    it('accepts a line EXACTLY at the per-line ceiling', () => {
      expect(checkCheckoutLimits([line(MAX_QUANTITY_PER_LINE)]).breach).toBeNull();
    });
  });

  describe('per-line quantity', () => {
    it('names the lines to reduce rather than only refusing', () => {
      const state = checkCheckoutLimits([
        line(1), line(MAX_QUANTITY_PER_LINE + 1), line(2), line(200),
      ]);
      expect(state.breach).toBe('line_quantity');
      expect(state.overLimitLineIndexes).toEqual([1, 3]);
      expect(state.message).toContain(String(MAX_QUANTITY_PER_LINE));
    });

    it('reports the per-line breach FIRST, because it is the actionable one', () => {
      // Also over the total-units ceiling; the diner still needs to be told
      // which line to reduce.
      const lines = Array.from({ length: 10 }, () => line(200));
      expect(checkCheckoutLimits(lines).breach).toBe('line_quantity');
    });
  });

  // Published ceilings that the whole-request total cannot stand in for: each of
  // these baskets sits far below 2,048 entries and the server still refuses it,
  // so a preflight that only counted the total would send the diner on a round
  // trip to be told what it already knew.
  describe('per-line selection dimensions', () => {
    const groups = (count: number, choicesEach = 1) => ({
      quantity: 1,
      selectedModifiers: Array.from({ length: count }, (_, g) => ({
        choices: Array.from({ length: choicesEach }, (_, c) => `g${g}c${c}`),
      })),
      extras: [],
    });

    it('accepts a line EXACTLY at each per-line ceiling', () => {
      expect(checkCheckoutLimits([groups(MAX_MODIFIER_GROUPS_PER_LINE)]).breach)
        .toBeNull();
      expect(checkCheckoutLimits([line(1, MAX_CHOICES_PER_GROUP)]).breach)
        .toBeNull();
      expect(checkCheckoutLimits([line(1, 0, MAX_EXTRAS_PER_LINE)]).breach)
        .toBeNull();
    });

    it('refuses one modifier group too many, and names the line', () => {
      const state = checkCheckoutLimits([
        line(1),
        groups(MAX_MODIFIER_GROUPS_PER_LINE + 1),
      ]);
      expect(state.breach).toBe('line_selections');
      expect(state.overLimitLineIndexes).toEqual([1]);
      expect(state.message).toContain(`${MAX_MODIFIER_GROUPS_PER_LINE}`);
    });

    it('refuses one choice too many in a single group', () => {
      const state = checkCheckoutLimits([line(1, MAX_CHOICES_PER_GROUP + 1)]);
      expect(state.breach).toBe('line_selections');
      expect(state.overLimitLineIndexes).toEqual([0]);
    });

    it('refuses one extra too many on a single line', () => {
      const state = checkCheckoutLimits([line(1, 0, MAX_EXTRAS_PER_LINE + 1)]);
      expect(state.breach).toBe('line_selections');
      expect(state.overLimitLineIndexes).toEqual([0]);
    });

    // The widest group is what the server measures — spreading the same total
    // across several groups is perfectly legal.
    it('measures choices per GROUP, not per line', () => {
      const spread = {
        quantity: 1,
        selectedModifiers: [
          { choices: Array.from({ length: MAX_CHOICES_PER_GROUP }, (_, i) => `a${i}`) },
          { choices: Array.from({ length: MAX_CHOICES_PER_GROUP }, (_, i) => `b${i}`) },
        ],
        extras: [],
      };
      expect(checkCheckoutLimits([spread]).breach).toBeNull();
    });

    // Quantity is the one a diner can actually act on with the stepper, so it
    // keeps precedence over a dimension the menu itself decided.
    it('still reports an over-quantity line first', () => {
      const state = checkCheckoutLimits([
        { ...groups(MAX_MODIFIER_GROUPS_PER_LINE + 1), quantity: MAX_QUANTITY_PER_LINE + 1 },
      ]);
      expect(state.breach).toBe('line_quantity');
    });
  });

  describe('the whole-order ceilings', () => {
    it('refuses more lines than an order may carry', () => {
      const lines = Array.from({ length: MAX_LINES_PER_ORDER + 1 }, () => line(1));
      const state = checkCheckoutLimits(lines);
      expect(state.breach).toBe('too_many_lines');
      expect(state.overLimitLineIndexes).toEqual([]);
    });

    it('accepts exactly the maximum number of lines', () => {
      const lines = Array.from({ length: MAX_LINES_PER_ORDER }, () => line(1));
      expect(checkCheckoutLimits(lines).breach).toBeNull();
    });

    it('refuses more total units than an order may carry', () => {
      const lines = Array.from({ length: 10 }, () => line(51));
      expect(checkCheckoutLimits(lines).breach).toBe('too_many_units');
    });

    it('accepts exactly the maximum total units', () => {
      const lines = Array.from({ length: 10 }, () => line(MAX_TOTAL_UNITS / 10));
      expect(checkCheckoutLimits(lines).breach).toBeNull();
    });

    // RAW entries, before de-duplication — the same basis the backend counts on.
    it('counts raw choice and extra entries across the whole request', () => {
      const lines = Array.from({ length: 40 }, () => line(1, 60, 0));
      expect(checkCheckoutLimits(lines).breach).toBe('too_many_selections');
    });

    it('counts extras toward that same request ceiling', () => {
      const lines = Array.from({ length: 40 }, () => line(1, 30, 30));
      expect(checkCheckoutLimits(lines).breach).toBe('too_many_selections');
    });
  });

  describe('atLineQuantityCeiling', () => {
    it('stops the stepper where the server would refuse the next unit', () => {
      expect(atLineQuantityCeiling(MAX_QUANTITY_PER_LINE - 1)).toBeFalse();
      expect(atLineQuantityCeiling(MAX_QUANTITY_PER_LINE)).toBeTrue();
    });

    // A RESTORED basket can legitimately arrive above the ceiling: the server
    // merges several valid lines into one stored row, and that row is allowed
    // to exceed what may be SUBMITTED. It must stay reducible, not be clamped.
    it('treats an already-over line as at the ceiling, not as an error to clamp', () => {
      expect(atLineQuantityCeiling(MAX_QUANTITY_PER_LINE + 40)).toBeTrue();
      const state = checkCheckoutLimits([line(MAX_QUANTITY_PER_LINE + 40)]);
      expect(state.breach).toBe('line_quantity');
      expect(state.overLimitLineIndexes).toEqual([0]);
    });

    it('handles a missing quantity without claiming the ceiling', () => {
      expect(atLineQuantityCeiling(undefined as unknown as number)).toBeFalse();
    });
  });
});
