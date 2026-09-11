/**
 * Exact decimal money for the checkout comparison (D02).
 *
 * THE THING THIS MUST NOT BE is `Math.round(Number(value) * 100)`. Converting a
 * decimal string to a binary `Number` before scaling is not an exact decimal
 * parser — `Number('1.005') * 100` is `100.49999999999999` — and `Math.round` is
 * not the backend's ROUND_HALF_EVEN rule either. Comparing a browser estimate
 * against a server amount through that pair would disagree on exactly the values
 * a diner would notice, and would then be "fixed" with an epsilon, which is a
 * decision to stop noticing.
 *
 * So the server's amount is parsed from its CANONICAL DECIMAL STRING by reading
 * the digits, never by going through a float. Comparison is integer equality on
 * the scaled value; there is no tolerance anywhere.
 *
 * BOUNDS ARE ENFORCED, not assumed. The scaled value must stay a safe integer,
 * and so must every sum and every product that feeds one — a schema that can
 * store 48 integer digits is not a statement about what JavaScript can represent
 * exactly. Anything outside those bounds is `null`, an explicit "cannot compare",
 * never a silent 0.
 */

/** Money is carried at two decimal places, matching every backend column. */
export const MONEY_SCALE = 2;
const SCALE_FACTOR = 100;

/**
 * Largest scaled (minor-unit) amount this module will represent exactly.
 * `Number.MAX_SAFE_INTEGER` is the hard ceiling; this leaves generous headroom
 * so summing a basket cannot reach it unnoticed. It is a TECHNICAL limit of
 * exact representation, not a commercial price cap.
 */
export const MAX_SAFE_MINOR_UNITS = 2 ** 40; // ~1.1e12 minor units

const DECIMAL_PATTERN = /^[+-]?(\d+)(?:\.(\d*))?$/;
/** Bounds the work before any parsing: a long literal is refused, not parsed. */
const MAX_DECIMAL_TEXT_LENGTH = 32;

/**
 * Parse a canonical decimal string (or a finite JS number) into scaled minor
 * units. Returns `null` for anything that cannot be represented exactly —
 * missing, malformed, non-finite, too many decimal places, or out of range.
 *
 * `null` is deliberately NOT zero. A missing or unreadable price is an error
 * state for the caller to surface; rendering it as free is the failure this
 * module exists to prevent.
 */
export function toMinorUnits(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;

  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }

  if (!text || text.length > MAX_DECIMAL_TEXT_LENGTH) return null;

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) return null;

  const negative = text.startsWith('-');
  const whole = match[1];
  const fraction = match[2] ?? '';
  // More precision than the contract carries cannot be compared exactly, and
  // rounding it here would invent a value the server never sent.
  if (fraction.length > MONEY_SCALE) return null;

  const padded = (fraction + '00').slice(0, MONEY_SCALE);
  // Read the digits directly: no float multiplication anywhere on this path.
  const scaled = Number(whole + padded);
  if (!Number.isSafeInteger(scaled) || scaled > MAX_SAFE_MINOR_UNITS) return null;
  return negative ? -scaled : scaled;
}

/** Scaled minor units back to a display number (major units). */
export function fromMinorUnits(minor: number | null): number | null {
  if (minor === null || !Number.isSafeInteger(minor)) return null;
  return minor / SCALE_FACTOR;
}

/**
 * Add scaled amounts, refusing to overflow the exact range. `null` propagates —
 * a total containing one unreadable component is itself unreadable.
 */
export function addMinorUnits(...amounts: (number | null)[]): number | null {
  let total = 0;
  for (const amount of amounts) {
    if (amount === null || !Number.isSafeInteger(amount)) return null;
    total += amount;
    if (!Number.isSafeInteger(total) || Math.abs(total) > MAX_SAFE_MINOR_UNITS) {
      return null;
    }
  }
  return total;
}

/** Multiply a scaled amount by a whole quantity, within the exact range. */
export function multiplyMinorUnits(
  amount: number | null,
  quantity: number,
): number | null {
  if (amount === null || !Number.isSafeInteger(amount)) return null;
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null;
  const product = amount * quantity;
  if (!Number.isSafeInteger(product) || Math.abs(product) > MAX_SAFE_MINOR_UNITS) {
    return null;
  }
  return product;
}

/**
 * Do two amounts represent the same money? EXACT integer equality — no epsilon,
 * no display rounding. `null` on either side is "cannot tell", which is never
 * the same as "equal".
 */
export function sameAmount(a: unknown, b: unknown): boolean {
  const left = toMinorUnits(a);
  const right = toMinorUnits(b);
  if (left === null || right === null) return false;
  return left === right;
}
