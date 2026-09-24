/**
 * DOES THE SERVER'S QUOTE SAY ANYTHING THE BASKET DID NOT ALREADY SHOW?
 *
 * The plain "Are you sure you want to place this order?" prompt (#693) states
 * no amount and lists no lines. It may therefore stand in for the itemised
 * review only when the quote agrees with the basket the diner was looking at,
 * LINE BY LINE. An equal grand total is not that: two lines whose prices moved
 * by offsetting amounts, or a selected choice whose label the restaurant
 * changed under the same id and the same price, both leave the total exactly
 * where it was.
 *
 * `true` means EQUIVALENCE WAS ESTABLISHED. Anything this function cannot
 * establish (no itemised quote, a line it cannot pair, a missing or
 * unreadable fact) answers `false`, which shows the itemised review. That is
 * the safe direction: the review is the existing, complete confirmation, and
 * showing it for an unchanged order costs the diner nothing but a longer look.
 *
 * WHAT IS COMPARED, and why each is enough:
 *   - the dish (`item` id), paired by the SERVER's line identity: dish id, the
 *     complete choice-id selection per group, and the extra ids. Sets are
 *     sorted, so the order the diner tapped choices in never matters, and
 *     basket lines that share an identity are summed, because the server
 *     merges identical configurations into one row.
 *   - the dish name, and each extra's name, as the basket showed them.
 *   - the quantity, on the dish and on every extra (one extra per dish).
 *   - the option LABELS, rebuilt from the basket's own group and choice names
 *     in the exact form the server snapshots them (`"Group: A, B"`, choices in
 *     the order the server's canonical selection lists them) and compared as a
 *     multiset, as the server itself compares them.
 *   - the money, exactly and in integer minor units: the per-unit option cost,
 *     each extra's amount, and the line total. With those three equal the
 *     dish's own price is equal too, so nothing the basket displayed can have
 *     moved.
 *
 * WHAT IS NOT: anything the basket never showed. Unselected options, menu
 * descriptions, row ids and display order cannot make an unchanged purchase
 * look changed.
 *
 * It reads only a quote `reviewQuote` has already validated, and is
 * deliberately not a second reading of the wire: an unreadable or legacy
 * quote never reaches the comparison at all.
 */
import { OrderQuoteExtra, OrderQuoteLine } from '../../_models/app.models';
import {
  addMinorUnits,
  multiplyMinorUnits,
  toMinorUnits,
  toMinorUnitsRounded,
} from '../utils/decimal-money';
import { lineSubtotalMinor, modifiersMinor } from './line-money';
import { QuoteReview } from './quote-review';

/** The facts of one basket line this comparison reads. Structural, so a
 *  snapshot of the basket can be passed without the service. */
export interface BasketLineFacts {
  itemId: string;
  itemName: string;
  basePrice: unknown;
  quantity: number;
  selectedModifiers?: {
    groupId: string;
    groupName: string;
    choices: { id: string; name: string; additionalCost?: unknown }[];
  }[] | null;
  extras?: { id: string; name: string; cost?: unknown }[] | null;
}

export function quoteMatchesBasket(
  basket: readonly BasketLineFacts[] | null | undefined,
  review: QuoteReview,
): boolean {
  if (!review.readable || !review.itemised) return false;
  if (!basket || basket.length === 0) return false;

  const baskets = groupBasket(basket);
  if (baskets === null) return false;

  const quoted = new Map<string, OrderQuoteLine>();
  for (const line of review.lines) {
    const key = quoteKey(line);
    // Two server rows for one configuration: the pairing is ambiguous.
    if (key === null || quoted.has(key)) return false;
    quoted.set(key, line);
  }
  if (quoted.size !== baskets.size) return false;

  for (const [key, group] of baskets) {
    const line = quoted.get(key);
    if (!line || !lineMatches(line, group)) return false;
  }
  return true;
}

/** One configuration as the basket holds it: every basket line sharing an
 *  identity, which the server will have merged into one row. */
interface BasketGroup {
  line: BasketLineFacts;
  quantity: number;
  totalMinor: number;
}

function groupBasket(basket: readonly BasketLineFacts[]):
  Map<string, BasketGroup> | null {
  const groups = new Map<string, BasketGroup>();
  for (const line of basket) {
    const key = basketKey(line);
    const total = lineSubtotalMinor(line);
    if (key === null || total === null) return null;
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) return null;
    const existing = groups.get(key);
    if (existing) {
      // One identity shown twice (a basket saved before identity was
      // normalised). They merge only if they SHOWED the same thing; otherwise
      // there is no single set of facts to compare against.
      if (displayed(existing.line) !== displayed(line)) return null;
      const sum = addMinorUnits(existing.totalMinor, total);
      if (sum === null) return null;
      existing.quantity += line.quantity;
      existing.totalMinor = sum;
    } else {
      groups.set(key, { line, quantity: line.quantity, totalMinor: total });
    }
  }
  return groups;
}

function lineMatches(line: OrderQuoteLine, group: BasketGroup): boolean {
  const basket = group.line;
  if (line.available !== true) return false;
  if (line.quantity !== group.quantity) return false;
  if (line.item_name !== basket.itemName) return false;

  // Option labels, in the server's own form.
  const expected = expectedLabels(line, basket);
  const labels = line.modifiers;
  if (expected === null || !Array.isArray(labels)) return false;
  if (!labels.every((l) => typeof l === 'string')) return false;
  if (!sameMultiset(expected, labels as string[])) return false;

  // Money: per-unit options, each extra, and the line.
  const options = modifiersMinor(basket.selectedModifiers);
  if (options === null || toMinorUnits(line.unit_cost_of_options) !== options) {
    return false;
  }
  if (!extrasMatch(line.extras, basket, group.quantity)) return false;
  const total = toMinorUnits(line.line_total_with_extras);
  return total !== null && total === group.totalMinor;
}

/**
 * The labels the server would write for the basket's own names.
 *
 * Walks the server's canonical selection, so the choices inside a group come
 * out in the server's order and the diner's tapping order cannot produce a
 * difference. `null` when a selected id has no name in the basket, which only
 * happens when the two are not the same configuration.
 */
function expectedLabels(line: OrderQuoteLine, basket: BasketLineFacts):
  string[] | null {
  const selection = line.selected_modifiers;
  if (!selection || typeof selection !== 'object') return null;
  const labels: string[] = [];
  for (const [groupId, choiceIds] of Object.entries(selection)) {
    if (!Array.isArray(choiceIds) || choiceIds.length === 0) continue;
    const group = (basket.selectedModifiers ?? [])
      .find((g) => String(g.groupId) === String(groupId));
    if (!group || typeof group.groupName !== 'string') return null;
    const names: string[] = [];
    for (const id of choiceIds) {
      const choice = group.choices.find((c) => String(c.id) === String(id));
      if (!choice || typeof choice.name !== 'string') return null;
      names.push(choice.name);
    }
    labels.push(`${group.groupName}: ${names.join(', ')}`);
  }
  return labels;
}

/** Every extra, by id, name, quantity and exact amount. Both sides are sorted
 *  the same way, so a repeated extra pairs one for one. */
function extrasMatch(
  extras: OrderQuoteExtra[] | undefined,
  basket: BasketLineFacts,
  quantity: number,
): boolean {
  const server = Array.isArray(extras) ? extras : [];
  const mine = basket.extras ?? [];
  if (server.length !== mine.length) return false;

  const theirs: string[] = [];
  for (const extra of server) {
    if (extra?.available !== true || extra.quantity !== quantity) return false;
    const amount = toMinorUnits(extra.actual_cost);
    if (amount === null || typeof extra.item_name !== 'string') return false;
    theirs.push(JSON.stringify([String(extra.item), extra.item_name, amount]));
  }
  const ours: string[] = [];
  for (const extra of mine) {
    const amount = multiplyMinorUnits(toMinorUnitsRounded(extra?.cost ?? 0), quantity);
    if (amount === null || typeof extra?.name !== 'string') return false;
    ours.push(JSON.stringify([String(extra.id), extra.name, amount]));
  }
  return sameMultiset(theirs, ours);
}

/** The server's line identity for a quote row: dish, selection, extras. */
function quoteKey(line: OrderQuoteLine): string | null {
  if (!line || typeof line.item !== 'string') return null;
  const selection = line.selected_modifiers;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    return null;
  }
  const groups: [string, string[]][] = [];
  for (const [groupId, choiceIds] of Object.entries(selection)) {
    if (!Array.isArray(choiceIds)) return null;
    groups.push([groupId, choiceIds.map(String)]);
  }
  const extras = Array.isArray(line.extras) ? line.extras : [];
  return identity(line.item, groups, extras.map((e) => String(e?.item)));
}

/** The same identity, built from a basket line. */
function basketKey(line: BasketLineFacts): string | null {
  if (!line || line.itemId == null) return null;
  const groups: [string, string[]][] = (line.selectedModifiers ?? [])
    .map((g) => [String(g.groupId), (g.choices ?? []).map((c) => String(c.id))]);
  return identity(String(line.itemId), groups,
    (line.extras ?? []).map((e) => String(e?.id)));
}

/** Choice ids de-duplicated and sorted per group, empty groups dropped, groups
 *  sorted, extras sorted and kept as a multiset. Mirrors `lineIdentity` in the
 *  basket service, which mirrors the server. */
function identity(item: string, groups: [string, string[]][], extras: string[]):
  string {
  const m = groups
    .map(([g, c]) => ({ g, c: Array.from(new Set(c)).sort() }))
    .filter((group) => group.c.length > 0)
    .sort((a, b) => (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
  return JSON.stringify({ i: item, m, e: [...extras].sort() });
}

/** What the basket displayed for one unit of a line, for merging lines.
 *  Sorted, so two copies listing the same facts in a different order agree. */
function displayed(line: BasketLineFacts): string {
  const sorted = (rows: string[]) => [...rows].sort();
  return JSON.stringify([
    line.itemName,
    toMinorUnitsRounded(line.basePrice),
    sorted((line.selectedModifiers ?? []).flatMap((g) => (g.choices ?? []).map((c) =>
      JSON.stringify([g.groupId, g.groupName, c.id, c.name,
                      toMinorUnitsRounded(c.additionalCost ?? 0)])))),
    sorted((line.extras ?? []).map((e) =>
      JSON.stringify([e.id, e.name, toMinorUnitsRounded(e.cost ?? 0)]))),
  ]);
}

function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}
