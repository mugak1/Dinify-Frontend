/**
 * D02 completion A — the diner's arithmetic, held to the SERVER's goldens.
 *
 * Every expected value here is written out as a literal and is the SAME value
 * the backend suite asserts (`orders_app/tests_order_money_wire.py`). That is
 * the point: the same arithmetic happens twice, in two languages, and a shared
 * golden is the only thing that can catch them drifting. A test that computed
 * its expectation with the arithmetic under test would agree with any defect.
 */
import {
  MAX_SAFE_MINOR_UNITS,
  formatAmount,
  formatMinorUnits,
  fromMinorUnits,
  toMinorUnits,
  toMinorUnitsRounded,
} from '../utils/decimal-money';
import {
  basketTotalMinor,
  lineOriginalSubtotalMinor,
  lineSubtotalMinor,
  lineUnitMinor,
} from './line-money';

const line = (over: Record<string, unknown> = {}) => ({
  basePrice: 5000,
  selectedModifiers: [],
  extras: [],
  quantity: 1,
  ...over,
});

describe('per-component rounding', () => {
  it('rounds each modifier adjustment ONCE, half-even, before adding', () => {
    // THE SHARED GOLDEN. Two 1.005 adjustments are 1.00 each under
    // ROUND_HALF_EVEN, so a 1000 base prices at 1002.00. Summing first and
    // rounding after gives 1002.01; IEEE doubles give 1002.0099999999999.
    const unit = lineUnitMinor(line({
      basePrice: 1000,
      selectedModifiers: [{
        choices: [{ additionalCost: '1.005' }, { additionalCost: '1.005' }],
      }],
    }));
    expect(unit).toBe(100200);
    expect(formatMinorUnits(unit)).toBe('1,002.00');
  });

  it('breaks a tie to the EVEN cent in both directions', () => {
    expect(toMinorUnitsRounded('1.005')).toBe(100);   // down, to even
    expect(toMinorUnitsRounded('1.015')).toBe(102);   // up, to even
    expect(toMinorUnitsRounded('1.025')).toBe(102);   // down, to even
    expect(toMinorUnitsRounded('-1.005')).toBe(-100);
    expect(toMinorUnitsRounded('-1.015')).toBe(-102);
  });

  it('is not a truncation: past the half goes up', () => {
    expect(toMinorUnitsRounded('1.0051')).toBe(101);
    expect(toMinorUnitsRounded('1.006')).toBe(101);
    expect(toMinorUnitsRounded('1.004')).toBe(100);
  });

  it('never routes a tie through a float', () => {
    // `Number('1.005')` is 1.00499999999999989, so any implementation that
    // converted first would round DOWN here for the wrong reason and up at
    // 1.015 for the wrong reason too. Asserting both pins the digit path.
    expect(toMinorUnitsRounded('1.005')).toBe(100);
    expect(toMinorUnitsRounded('1.015')).toBe(102);
  });

  it('keeps a SERVER amount exact rather than rounding it', () => {
    // The other half of the distinction: a server amount with impossible
    // precision is a contract violation, not something to round into agreement.
    expect(toMinorUnits('1.005')).toBeNull();
    expect(toMinorUnits('899.10')).toBe(89910);
  });
});

describe('a discounted extra', () => {
  // The server resolves 999 at 10% off to 899.10 and publishes that string;
  // the client extends it. These are the backend suite's values.
  const withSauce = (quantity: number) => line({
    basePrice: 5000,
    extras: [{ cost: 899.1 }],
    quantity,
  });

  it('carries the exact unit through quantity 1', () => {
    expect(lineSubtotalMinor(withSauce(1))).toBe(589910);
    expect(formatMinorUnits(lineSubtotalMinor(withSauce(1)))).toBe('5,899.10');
  });

  it('extends to exactly three times at quantity 3', () => {
    expect(lineSubtotalMinor(withSauce(3))).toBe(589910 * 3);
    expect(formatMinorUnits(lineSubtotalMinor(withSauce(3)))).toBe('17,697.30');
  });

  it('reconciles 3 against 1 + 2', () => {
    const one = lineSubtotalMinor(withSauce(1))!;
    const two = lineSubtotalMinor(withSauce(2))!;
    const three = lineSubtotalMinor(withSauce(3))!;
    expect(three).toBe(one + two);
  });
});

describe('unreadable components', () => {
  it('is null, never zero, for a malformed base price', () => {
    expect(lineSubtotalMinor(line({ basePrice: 'abc' }))).toBeNull();
    expect(lineSubtotalMinor(line({ basePrice: null }))).toBeNull();
    expect(lineSubtotalMinor(line({ basePrice: NaN }))).toBeNull();
    expect(lineSubtotalMinor(line({ basePrice: Infinity }))).toBeNull();
  });

  it('propagates through the basket rather than dropping the line', () => {
    expect(basketTotalMinor([line(), line({ basePrice: 'abc' })])).toBeNull();
  });

  it('refuses a fractional or negative quantity', () => {
    expect(lineSubtotalMinor(line({ quantity: 1.5 }))).toBeNull();
    expect(lineSubtotalMinor(line({ quantity: -1 }))).toBeNull();
  });

  it('treats a legitimate zero as a real amount', () => {
    expect(lineSubtotalMinor(line({ basePrice: 0 }))).toBe(0);
    expect(formatMinorUnits(0)).toBe('0.00');
  });
});

describe('bounds', () => {
  it('refuses a product outside the exactly-representable range', () => {
    expect(lineSubtotalMinor(line({
      basePrice: MAX_SAFE_MINOR_UNITS / 100, quantity: 1000,
    }))).toBeNull();
  });

  it('is honest about the boundary rather than narrowing it quietly', () => {
    // At the ceiling it still answers; past it, null. The technical limit is
    // stated, not disguised as a price cap.
    const atCeiling = lineSubtotalMinor(line({
      basePrice: MAX_SAFE_MINOR_UNITS / 100, quantity: 1,
    }));
    expect(atCeiling).toBe(MAX_SAFE_MINOR_UNITS);
  });
});

describe('savings', () => {
  it('prices the same line without its discounts', () => {
    const discounted = {
      basePrice: 900,
      originalBasePrice: 1000,
      isDiscounted: true,
      selectedModifiers: [],
      extras: [{ cost: 450, originalCost: 500 }],
      quantity: 2,
    };
    expect(lineSubtotalMinor(discounted)).toBe(270000);
    expect(lineOriginalSubtotalMinor(discounted, true)).toBe(300000);
  });

  it('is null — not zero — when the line carries no discount', () => {
    expect(lineOriginalSubtotalMinor(line(), false)).toBeNull();
  });
});

describe('display formatting', () => {
  it('keeps the scale the server sent', () => {
    expect(formatAmount('899.10')).toBe('899.10');
    expect(formatAmount('0.00')).toBe('0.00');
    expect(formatAmount('1000')).toBe('1,000.00');
    expect(formatAmount('10000000.05')).toBe('10,000,000.05');
  });

  it('has no display form for an unreadable amount', () => {
    expect(formatAmount(undefined)).toBeNull();
    expect(formatAmount('abc')).toBeNull();
    expect(formatAmount(null)).toBeNull();
  });

  it('round-trips through major units without drift', () => {
    expect(fromMinorUnits(toMinorUnits('899.10'))).toBe(899.1);
  });
});
