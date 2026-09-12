/**
 * THE exact arithmetic for a diner basket line (D02 completion A).
 *
 * WHY THIS EXISTS. `decimal-money.ts` gave the checkout an exact comparison, and
 * it was wired into exactly one place — the "does the server's total match?"
 * label. Every figure the diner actually READS went on being produced by
 * ordinary `Number` addition and multiplication spread across three files:
 * `BasketService.calculateTotalAmount`, the basket's `getSubtotal` /
 * `getOriginalSubtotal`, and item-detail's `computedItemTotal` / `addToBasket`.
 * An exact helper nobody's arithmetic goes through is not an exact contract.
 *
 * WHAT IT IS. Integer minor units end to end: every component is parsed once
 * (`toMinorUnits`), summed and multiplied as integers, and only converted back
 * at the edges. Two adjustments of `1.005` are `1.00` each — the SERVER'S
 * per-component ROUND_HALF_EVEN rule, reproduced rather than approximated — so a
 * 1000 base prices at 1002.00, where `1000 + 1.005 + 1.005` in doubles gives
 * 1002.0099999999999.
 *
 * `null` MEANS CANNOT REPRESENT, and it propagates. It is never 0: a line with
 * one unreadable component has no total, and showing zero would present an
 * unknown amount as free.
 *
 * THE INPUTS ARE THE EXISTING NUMERIC CATALOGUE FORMS, deliberately. A basket is
 * persisted in browser storage and its stored shape predates this module, so the
 * adapter takes what is there (finite numbers, decimal strings) rather than
 * demanding a migration of everybody's saved basket. Precision that was already
 * lost in a stored `number` is NOT recoverable here and this module never
 * pretends otherwise — it stops the loss going any further.
 */
import {
  addMinorUnits,
  multiplyMinorUnits,
  toMinorUnitsRounded,
} from '../utils/decimal-money';

/** The parts of a basket line this module reads. Structural, so both the basket
 *  component and the item-detail screen can feed it without a shared class. */
export interface PricedLineParts {
  basePrice: unknown;
  selectedModifiers?: { choices?: { additionalCost?: unknown }[] }[] | null;
  extras?: { cost?: unknown; originalCost?: unknown }[] | null;
  quantity?: unknown;
}

/** Sum every selected modifier adjustment, each parsed exactly once. */
export function modifiersMinor(
  selectedModifiers: PricedLineParts['selectedModifiers'],
): number | null {
  const parts: (number | null)[] = [];
  for (const group of selectedModifiers || []) {
    for (const choice of group?.choices || []) {
      parts.push(toMinorUnitsRounded(choice?.additionalCost ?? 0));
    }
  }
  return addMinorUnits(...parts);
}

/** Sum a line's extras at their EFFECTIVE cost (`original` for the pre-discount
 *  figure). Each extra is one per unit of the parent dish, so this is a UNIT
 *  component — the quantity is applied once, to the whole unit. */
export function extrasMinor(
  extras: PricedLineParts['extras'],
  which: 'effective' | 'original' = 'effective',
): number | null {
  const parts: (number | null)[] = [];
  for (const extra of extras || []) {
    const value = which === 'original'
      ? (extra?.originalCost ?? extra?.cost ?? 0)
      : (extra?.cost ?? 0);
    parts.push(toMinorUnitsRounded(value));
  }
  return addMinorUnits(...parts);
}

/** One unit of a line: base + modifiers + extras, all exact. */
export function lineUnitMinor(line: PricedLineParts,
                              base: unknown = undefined): number | null {
  return addMinorUnits(
    toMinorUnitsRounded(base === undefined ? line.basePrice : base),
    modifiersMinor(line.selectedModifiers),
    extrasMinor(line.extras),
  );
}

/** A whole line: the unit extended over its quantity — ROUND-THEN-MULTIPLY, the
 *  server's rule, so a line of 3 is exactly three times the unit shown. */
export function lineSubtotalMinor(line: PricedLineParts): number | null {
  const quantity = quantityOf(line.quantity);
  if (quantity === null) return null;
  return multiplyMinorUnits(lineUnitMinor(line), quantity);
}

/** The same line priced WITHOUT its discounts, for the savings figure.
 *  `null` when the line carries no discount at all — the caller shows nothing
 *  rather than a zero saving. */
export function lineOriginalSubtotalMinor(
  line: PricedLineParts & { isDiscounted?: boolean; originalBasePrice?: unknown },
  hasDiscountedExtra: boolean,
): number | null {
  const parentDiscounted = !!line.isDiscounted && line.originalBasePrice != null;
  if (!parentDiscounted && !hasDiscountedExtra) return null;
  const quantity = quantityOf(line.quantity);
  if (quantity === null) return null;
  const unit = addMinorUnits(
    toMinorUnitsRounded(parentDiscounted ? line.originalBasePrice : line.basePrice),
    modifiersMinor(line.selectedModifiers),
    extrasMinor(line.extras, 'original'),
  );
  return multiplyMinorUnits(unit, quantity);
}

/** Every line of a basket, summed exactly. */
export function basketTotalMinor(lines: PricedLineParts[]): number | null {
  return addMinorUnits(...(lines || []).map(lineSubtotalMinor));
}

/** A whole, non-negative quantity, or `null`. A fractional or negative quantity
 *  is not a basket line this module will price. */
function quantityOf(value: unknown): number | null {
  const quantity = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null;
  return quantity;
}
