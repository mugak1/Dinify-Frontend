/**
 * Step 2 — diner round state v1, the table-scan half (`current_order.held`).
 *
 * THE ONE READER of the flag, used by every place the diner shell reads a
 * table scan (the initial scan, the session hydration and the poll), so the
 * three cannot disagree.
 *
 * OPTIONAL, AND ONLY AN EXPLICIT `true` COUNTS. An older backend sends no
 * `held`, and a missing or unreadable value means RELEASED: the banner keeps
 * today's wording exactly. It is also meaningful only beside `ongoing: true`,
 * because "the table's ongoing order is held" says nothing when there is no
 * ongoing order. `ongoing` and `order_id` keep their meanings and are not read
 * here.
 */
export function readCurrentOrderHeld(currentOrder: unknown): boolean {
  if (!currentOrder || typeof currentOrder !== 'object') return false;
  const c = currentOrder as { ongoing?: unknown; held?: unknown };
  return c.ongoing === true && c.held === true;
}
