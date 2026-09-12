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
  const parsed = parseDecimal(value);
  if (parsed === null) return null;
  // More precision than the contract carries cannot be compared exactly, and
  // rounding it here would invent a value the server never sent.
  if (parsed.fraction.length > MONEY_SCALE) return null;
  return scaledOrNull(parsed.negative, parsed.whole,
                      (parsed.fraction + '00').slice(0, MONEY_SCALE));
}

/**
 * Parse a monetary value the way the SERVER parses a stored CATALOGUE
 * component: two decimal places, ROUND_HALF_EVEN, applied once.
 *
 * THE DISTINCTION FROM `toMinorUnits` IS THE POINT, and getting it backwards
 * breaks something either way:
 *
 *   * A SERVER AMOUNT is parsed EXACTLY. It is already canonical, so extra
 *     precision means the contract was violated, and rounding it would silently
 *     agree with a number the server never sent — which is what a comparison
 *     exists to catch.
 *   * A CATALOGUE COMPONENT (a modifier's `additionalCost`, an operator-entered
 *     price) is an UNVALIDATED stored value that may legitimately carry more
 *     precision. `parse_money` quantizes every one of them half-even before
 *     using it, so a client that REFUSED `1.005` would refuse a line the server
 *     prices perfectly well, and a client that TRUNCATED it would disagree with
 *     the server by a cent.
 *
 * Half-even is applied to the digits, never through a float: `Number('1.005')`
 * is already 1.00499999999999989 before any rounding could happen.
 */
export function toMinorUnitsRounded(value: unknown): number | null {
  const parsed = parseDecimal(value);
  if (parsed === null) return null;
  const { negative, whole, fraction } = parsed;
  if (fraction.length <= MONEY_SCALE) {
    return scaledOrNull(negative, whole, (fraction + '00').slice(0, MONEY_SCALE));
  }

  const kept = fraction.slice(0, MONEY_SCALE);
  const rest = fraction.slice(MONEY_SCALE);
  const base = scaledOrNull(false, whole, kept);
  if (base === null) return null;

  const first = rest[0];
  const restIsExactlyHalf = first === '5' && /^0*$/.test(rest.slice(1));
  let rounded = base;
  if (first > '5') {
    rounded = base + 1;
  } else if (restIsExactlyHalf) {
    // TIE: to the EVEN cent, which is the server's rule. 1.005 -> 1.00,
    // 1.015 -> 1.02. Rounding half-UP here would put the client a cent above
    // the server on exactly the values a diner would notice.
    if (base % 2 !== 0) rounded = base + 1;
  } else if (first === '5') {
    // '5' followed by something non-zero is strictly more than half.
    rounded = base + 1;
  }

  if (!Number.isSafeInteger(rounded) || rounded > MAX_SAFE_MINOR_UNITS) return null;
  return negative ? -rounded : rounded;
}

interface ParsedDecimal {
  negative: boolean;
  whole: string;
  fraction: string;
}

function parseDecimal(value: unknown): ParsedDecimal | null {
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

  return {
    negative: text.startsWith('-'),
    whole: match[1],
    fraction: match[2] ?? '',
  };
}

function scaledOrNull(
  negative: boolean, whole: string, cents: string,
): number | null {
  // Read the digits directly: no float multiplication anywhere on this path.
  const scaled = Number(whole + cents);
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

/**
 * Render scaled minor units as a canonical display amount: grouped thousands,
 * EXACTLY two decimals, no exponent. `null` in, `null` out — an unreadable
 * amount has no display form, and inventing one is the failure this module
 * exists to prevent.
 *
 * NOT `| number`. Angular's number pipe formats a binary double and defaults to
 * at most three fraction digits with no minimum, so the server's `899.10`
 * renders `899.1` and `0.00` renders `0` — the diner is shown an amount that is
 * not the one they are agreeing to. Formatting from the integer keeps the scale
 * the contract carries.
 */
export function formatMinorUnits(minor: number | null): string | null {
  if (minor === null || !Number.isSafeInteger(minor)) return null;
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const whole = Math.floor(absolute / SCALE_FACTOR);
  const fraction = absolute - whole * SCALE_FACTOR;
  const grouped = whole.toLocaleString('en-US');
  const cents = String(fraction).padStart(MONEY_SCALE, '0');
  return `${negative ? '-' : ''}${grouped}.${cents}`;
}

/**
 * Format any canonical decimal string (or finite number) for display, or
 * `null` when it cannot be represented exactly.
 */
export function formatAmount(value: unknown): string | null {
  return formatMinorUnits(toMinorUnits(value));
}
