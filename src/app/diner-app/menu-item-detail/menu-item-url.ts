/**
 * Constructs the route array for the diner item-detail page.
 *
 * Centralised so a future migration from item IDs to slugs only requires
 * updating this function (and adding a slug field on MenuItem) — not every
 * navigation call site. The route component treats the param as opaque,
 * so the only thing that changes is what this helper emits.
 *
 * Usage: this.router.navigate(menuItemUrl(tableId, item.id));
 */
export function menuItemUrl(tableId: string, itemId: string): unknown[] {
  return ['/diner', 'h', tableId, 'item', itemId];
}
