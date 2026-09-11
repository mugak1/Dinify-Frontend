import {
  MAX_SAFE_MINOR_UNITS,
  addMinorUnits,
  fromMinorUnits,
  multiplyMinorUnits,
  sameAmount,
  toMinorUnits,
} from './decimal-money';

describe('decimal-money (exact checkout comparison)', () => {
  describe('toMinorUnits', () => {
    it('reads the digits of a canonical decimal string', () => {
      expect(toMinorUnits('40500.00')).toBe(4050000);
      expect(toMinorUnits('0.01')).toBe(1);
      expect(toMinorUnits('0.00')).toBe(0);
      expect(toMinorUnits('7')).toBe(700);
      expect(toMinorUnits('7.5')).toBe(750);
    });

    // THE defect this module exists to prevent. Math.round(Number(v) * 100)
    // gives 100 here by way of 100.49999999999999 — a different answer arrived
    // at by a route that is wrong for a whole class of values.
    it('does NOT route a decimal string through a binary float', () => {
      expect(Math.round(Number('1.005') * 100)).toBe(100);
      expect(toMinorUnits('1.005')).toBeNull();
      expect(toMinorUnits('1.00')).toBe(100);
      expect(toMinorUnits('1.01')).toBe(101);
    });

    it('refuses more precision than the money contract carries', () => {
      expect(toMinorUnits('1.234')).toBeNull();
      expect(toMinorUnits('1.230')).toBeNull();
    });

    it('returns null — never 0 — for anything unreadable', () => {
      for (const bad of [
        null, undefined, '', '   ', 'abc', '1,000.00', '1e3', 'NaN',
        'Infinity', NaN, Infinity, -Infinity, true, false, {}, [], '0x10',
      ]) {
        expect(toMinorUnits(bad as unknown)).withContext(String(bad)).toBeNull();
      }
    });

    it('bounds the work before parsing rather than after', () => {
      expect(toMinorUnits('1'.repeat(33))).toBeNull();
    });

    it('refuses a magnitude it cannot hold exactly', () => {
      expect(toMinorUnits('1000000000000.00')).toBeNull();
      expect(toMinorUnits(String(Number.MAX_SAFE_INTEGER))).toBeNull();
    });

    it('accepts a signed value, since a refund is real money', () => {
      expect(toMinorUnits('-12.50')).toBe(-1250);
      expect(toMinorUnits('+12.50')).toBe(1250);
    });

    it('accepts a finite JS number without losing the scale', () => {
      expect(toMinorUnits(4050)).toBe(405000);
      expect(toMinorUnits(0)).toBe(0);
    });

    it('trims surrounding whitespace on a string', () => {
      expect(toMinorUnits('  40500.00  ')).toBe(4050000);
    });
  });

  describe('sameAmount', () => {
    it('compares exactly, with no tolerance', () => {
      expect(sameAmount('40500.00', 40500)).toBeTrue();
      expect(sameAmount('40500.00', '40500')).toBeTrue();
      expect(sameAmount('40500.00', '40500.01')).toBeFalse();
    });

    // One shilling apart is a real disagreement about money. An epsilon would
    // be a decision to stop noticing it.
    it('treats a one-minor-unit gap as a difference', () => {
      expect(sameAmount('0.01', '0.02')).toBeFalse();
    });

    it('never calls an unreadable value equal to anything', () => {
      expect(sameAmount(null, null)).toBeFalse();
      expect(sameAmount(undefined, 0)).toBeFalse();
      expect(sameAmount('abc', 'abc')).toBeFalse();
      expect(sameAmount(0, null)).toBeFalse();
    });
  });

  describe('addMinorUnits / multiplyMinorUnits', () => {
    it('sums scaled amounts exactly', () => {
      expect(addMinorUnits(4050000, 600000)).toBe(4650000);
      expect(addMinorUnits()).toBe(0);
    });

    it('propagates an unreadable component through the total', () => {
      expect(addMinorUnits(100, null, 200)).toBeNull();
    });

    it('scales a unit amount by a whole quantity', () => {
      expect(multiplyMinorUnits(1350000, 3)).toBe(4050000);
      expect(multiplyMinorUnits(1350000, 0)).toBe(0);
    });

    it('refuses a fractional or negative quantity', () => {
      expect(multiplyMinorUnits(100, 2.5)).toBeNull();
      expect(multiplyMinorUnits(100, -1)).toBeNull();
    });

    it('refuses a sum or product it could not hold exactly', () => {
      expect(addMinorUnits(MAX_SAFE_MINOR_UNITS, MAX_SAFE_MINOR_UNITS)).toBeNull();
      expect(multiplyMinorUnits(MAX_SAFE_MINOR_UNITS, 2)).toBeNull();
    });
  });

  describe('fromMinorUnits', () => {
    it('returns major units for display', () => {
      expect(fromMinorUnits(4050000)).toBe(40500);
      expect(fromMinorUnits(1)).toBe(0.01);
    });

    it('keeps null as null', () => {
      expect(fromMinorUnits(null)).toBeNull();
    });
  });

  // The worked example from the D02 report, end to end in exact integers.
  it('agrees with the server on the worked example', () => {
    const unit = toMinorUnits('13500.00');
    const line = multiplyMinorUnits(unit, 3);
    const extras = toMinorUnits('6000.00');
    expect(fromMinorUnits(line)).toBe(40500);
    expect(fromMinorUnits(addMinorUnits(line, extras))).toBe(46500);
    expect(sameAmount(fromMinorUnits(line), '40500.00')).toBeTrue();
  });
});
