import { percentChange } from './percent-change';

describe('percentChange', () => {
  it('returns the signed percentage for an ordinary increase', () => {
    expect(percentChange(135, 120)).toBeCloseTo(12.5, 10);
  });

  it('returns the signed percentage for an ordinary decrease', () => {
    expect(percentChange(90, 120)).toBeCloseTo(-25, 10);
  });

  // The bug this helper exists to remove. A zero baseline used to yield `0`, which the
  // cards rendered as "0.0% ▲" in success-green — telling a restaurant that went from no
  // trade at all to UGX 2M that it had been flat.
  it('returns null for a zero baseline rather than an invented 0%', () => {
    expect(percentChange(2_000_000, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it('returns null for a missing baseline', () => {
    expect(percentChange(100, null)).toBeNull();
    expect(percentChange(100, undefined)).toBeNull();
  });

  it('returns null for a non-finite baseline', () => {
    expect(percentChange(100, NaN)).toBeNull();
    expect(percentChange(100, Infinity)).toBeNull();
    expect(percentChange(100, -Infinity)).toBeNull();
  });

  // Deliberately wider than the original spec, which listed only 0 / null / undefined /
  // non-finite. A negative denominator sign-flips the raw formula, so -100,000 → 0 would
  // compute as -100% and render a red decline for what is actually a full recovery.
  // Reachable because revenue net is `gross - discounts - refunds`.
  it('returns null for a negative baseline instead of a sign-flipped percentage', () => {
    expect(percentChange(0, -100_000)).toBeNull();
    expect(percentChange(200, -500)).toBeNull();
  });

  it('returns null when current is non-finite', () => {
    expect(percentChange(NaN, 120)).toBeNull();
    expect(percentChange(Infinity, 120)).toBeNull();
  });

  // NOT null — a drop to zero from real prior trade is a true and statable -100%.
  // Suppressing it would hide a total collapse, which is the opposite of the goal.
  it('reports a drop to zero as -100%, not as a missing baseline', () => {
    expect(percentChange(0, 120)).toBe(-100);
  });
});
