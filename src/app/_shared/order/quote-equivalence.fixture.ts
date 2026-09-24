/**
 * A CORRECTED-wire quote that prices a basket exactly as the server would.
 *
 * Spec-only. Each equivalence spec starts from this faithful quote, asserts it
 * is readable and itemised, and then changes ONE fact, so a detailed review is
 * attributable to that fact and never to a structurally rejected quote.
 *
 * What it reproduces from the backend (`orders_app` at a6b25a6):
 *   - `selected_modifiers` is the canonical selection. By default it follows
 *     the basket's own order; `definitionOrder` gives the menu-definition order
 *     the server really uses (`normalize_selected_modifiers`), for the specs
 *     that prove a different tapping order changes nothing.
 *   - each label is `"Group: A, B"`, choices joined in that canonical order
 *     (`selection_meaning` / `choices_display`).
 *   - `unit_cost_of_options` is per unit; each extra is one per dish, so its
 *     quantity is the parent's and its `actual_cost` is unit × quantity;
 *     `line_total_with_extras` is the parent plus its extras.
 */
import { PRICING_VERSION_CORRECTED } from './checkout-limits';
import { BasketLineFacts } from './quote-equivalence';

export interface QuoteOptions {
  /** Canonical choice order per group id, as the menu definition lists it. */
  definitionOrder?: Record<string, string[]>;
}

const money = (minor: number) => (minor / 100).toFixed(2);
const minor = (value: unknown) => Math.round(Number(value ?? 0) * 100);

/** One faithful server line for `line`, with row ids derived from `index`. */
export function quotedLine(line: BasketLineFacts, index = 0,
                           options: QuoteOptions = {}): any {
  const quantity = line.quantity;
  const selected: Record<string, string[]> = {};
  const labels: string[] = [];
  let optionsMinor = 0;
  for (const group of line.selectedModifiers ?? []) {
    const ids = group.choices.map((c) => c.id);
    const order = options.definitionOrder?.[group.groupId];
    const canonical = order ? order.filter((id) => ids.includes(id)) : ids;
    selected[group.groupId] = canonical;
    labels.push(`${group.groupName}: ${canonical
      .map((id) => group.choices.find((c) => c.id === id)!.name).join(', ')}`);
    for (const choice of group.choices) optionsMinor += minor(choice.additionalCost);
  }
  const unit = minor(line.basePrice);
  const parent = (unit + optionsMinor) * quantity;
  const extras = (line.extras ?? []).map((extra, i) => ({
    id: `row-${index}-x${i}`, item: extra.id, item_name: extra.name,
    quantity, available: true, status: 'available',
    unit_price: money(minor(extra.cost)), discounted_price: money(minor(extra.cost)),
    actual_cost: money(minor(extra.cost) * quantity),
  }));
  const extrasMinor = (line.extras ?? []).reduce((s, e) => s + minor(e.cost) * quantity, 0);
  return {
    id: `row-${index}`, item: line.itemId, item_name: line.itemName,
    quantity, available: true, status: 'available',
    selected_modifiers: selected, modifiers: labels, options: [],
    unit_price: money(unit), reference_unit_price: money(unit),
    discounted_price: money(unit), unit_cost_of_options: money(optionsMinor),
    discounted: false,
    total_cost: money(parent), reference_total_cost: money(parent),
    discounted_cost: money(parent), savings: '0.00',
    line_actual_cost: money(parent),
    line_total_with_extras: money(parent + extrasMinor),
    extras,
  };
}

/** The `data` of a corrected `initiate` 200 around the given server lines.
 *  The total and the counts are derived from the lines, so they reconcile. */
export function quotePayload(lines: any[], details: Record<string, unknown> = {}): any {
  const total = lines.reduce((s, l) => s + minor(l.line_total_with_extras), 0);
  return {
    order_details: {
      id: 'o1', quote_ref: 'q1', pricing_version: PRICING_VERSION_CORRECTED,
      quote_total: money(total), actual_cost: money(total),
      no_available_items: lines.filter((l) => l.available).length,
      no_unavailable_items: lines.filter((l) => !l.available).length,
      checkout_protocol: 3, quote_protocol: 2,
      ...details,
    },
    order_items: [], available_items: [], unavailable_items: [],
    extras: [], available_extras: [], unavailable_extras: [],
    quote: lines,
  };
}

/** The server's faithful quote for a whole basket. */
export function quoteBasket(basket: BasketLineFacts[], options: QuoteOptions = {}): any {
  return quotePayload(basket.map((line, i) => quotedLine(line, i, options)));
}

/** A burger with one paid option and one paid extra, two of them: 14,000. */
export function burger(over: Partial<BasketLineFacts> & Record<string, unknown> = {}): BasketLineFacts & Record<string, any> {
  return {
    itemId: 'i1', itemName: 'Burger', basePrice: 5000, quantity: 2,
    selectedModifiers: [{
      groupId: 'g-size', groupName: 'Size',
      choices: [{ id: 'c-large', name: 'Large', additionalCost: 1000 }],
    }],
    extras: [{ id: 'x1', name: 'Extra cheese', cost: 1000 }],
    totalPrice: 7000, isDiscounted: false,
    ...over,
  };
}

/** A plain side: 3,000. */
export function chips(over: Partial<BasketLineFacts> & Record<string, unknown> = {}): BasketLineFacts & Record<string, any> {
  return {
    itemId: 'i2', itemName: 'Chips', basePrice: 3000, quantity: 1,
    selectedModifiers: [], extras: [], totalPrice: 3000, isDiscounted: false,
    ...over,
  };
}
