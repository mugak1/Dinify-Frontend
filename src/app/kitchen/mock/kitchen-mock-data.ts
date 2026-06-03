/**
 * Kitchen View — mock dataset (Phase 1, design-review only).
 *
 * Ages are RELATIVE to Date.now() (computed at call time) so escalation states
 * are stable and meaningful whenever the board loads. The set deliberately
 * exercises every UI state: each fulfilment_status, served tickets both inside
 * and outside the 10-min recall window, every age bucket (normal / approaching
 * / warning / overdue), >=2 priority tickets, modifiers, allergen badges,
 * item_notes, multi-item orders, both order sources, and enough volume to span
 * multiple grid pages.
 *
 * Allergen icon names map to the shared Lucide catalog in
 * src/app/_shared/tags/tag-palette.ts; colours use that palette's names.
 */

import { KitchenTicket, KitchenTicketItem } from '../models/kitchen.models';

/** ISO timestamp for `minutes` ago (fractional allowed). */
function minsAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// Reusable allergen snapshots (name / icon / colour).
const GLUTEN = { name: 'Gluten', icon: 'wheat', colour: 'amber' };
const DAIRY = { name: 'Dairy', icon: 'milk', colour: 'blue' };
const NUTS = { name: 'Nuts', icon: 'nut', colour: 'orange' };
const EGG = { name: 'Egg', icon: 'egg', colour: 'yellow' };
const FISH = { name: 'Fish', icon: 'fish', colour: 'cyan' };
const SHELLFISH = { name: 'Shellfish', icon: 'shell', colour: 'rose' };
const SPICY = { name: 'Spicy', icon: 'flame', colour: 'red' };
const VEGAN = { name: 'Vegan', icon: 'sprout', colour: 'green' };

let nextOrderNo = 100;
function build(
  id: string,
  table: string,
  source: KitchenTicket['order_source'],
  status: KitchenTicket['fulfilment_status'],
  priority: boolean,
  createdMinsAgo: number,
  items: KitchenTicketItem[],
  servedMinsAgo: number | null = null,
): KitchenTicket {
  return {
    id,
    order_number: nextOrderNo++,
    table_label: table,
    order_source: source,
    fulfilment_status: status,
    priority,
    created_at: minsAgo(createdMinsAgo),
    served_at: servedMinsAgo === null ? null : minsAgo(servedMinsAgo),
    items,
  };
}

/**
 * Returns a fresh mock set with ages computed against the current clock.
 * Called by the service behind the USE_MOCK_DATA seam.
 */
export function getMockTickets(): KitchenTicket[] {
  nextOrderNo = 101;
  return [
    // ── NEW ──────────────────────────────────────────────────────────────
    build('k-01', 'Table 7', 'diner_self_service', 'new', false, 0.5, [
      { item_name_snapshot: 'Margherita Pizza', quantity: 1, modifiers: ['Size: Large', 'Extra basil'], allergen_tags: [GLUTEN, DAIRY], extras: [{ item_name_snapshot: 'Extra mozzarella', quantity: 1, modifiers: [], allergen_tags: [DAIRY] }] },
      { item_name_snapshot: 'Sparkling Water', quantity: 2, modifiers: [], allergen_tags: [] },
    ]),
    build('k-02', 'Table 3', 'server_assisted', 'new', true, 1, [
      { item_name_snapshot: 'Chicken Wings', quantity: 1, modifiers: ['Sauce: Hot', 'Extra ranch'], allergen_tags: [DAIRY, SPICY], item_note: 'Allergy table — keep separate' },
    ]),
    build('k-03', 'Takeaway', 'diner_self_service', 'new', false, 2, [
      { item_name_snapshot: 'Veggie Burger', quantity: 1, modifiers: ['No mayo'], allergen_tags: [GLUTEN, VEGAN], extras: [{ item_name_snapshot: 'Add avocado', quantity: 1, modifiers: [], allergen_tags: [] }, { item_name_snapshot: 'Add vegan cheese', quantity: 1, modifiers: [], allergen_tags: [] }] },
      { item_name_snapshot: 'Sweet Potato Fries', quantity: 1, modifiers: [], allergen_tags: [] },
    ]),
    build('k-04', 'Table 12', 'diner_self_service', 'new', false, 4, [
      { item_name_snapshot: 'Caesar Salad', quantity: 1, modifiers: ['No croutons', 'Dressing on side'], allergen_tags: [EGG, FISH], item_note: 'Anchovy allergy — confirm dressing' },
    ]),

    // ── PREPARING (spanning age buckets) ──────────────────────────────────
    build('k-05', 'Table 5', 'server_assisted', 'preparing', false, 5, [
      { item_name_snapshot: 'Ribeye Steak', quantity: 1, modifiers: ['Temp: Medium-rare', 'Peppercorn sauce'], allergen_tags: [DAIRY] },
      { item_name_snapshot: 'Mashed Potato', quantity: 1, modifiers: [], allergen_tags: [DAIRY] },
    ]),
    // approaching warning (~7.5 min)
    build('k-06', 'Table 9', 'diner_self_service', 'preparing', false, 7.5, [
      { item_name_snapshot: 'Pad Thai', quantity: 2, modifiers: ['Spice: Medium', 'No peanuts on one'], allergen_tags: [NUTS, EGG, FISH], item_note: 'One portion strictly peanut-free' },
    ]),
    // warning (>= 8 min)
    build('k-07', 'Table 1', 'server_assisted', 'preparing', false, 9, [
      { item_name_snapshot: 'Seafood Linguine', quantity: 1, modifiers: ['Extra chilli'], allergen_tags: [GLUTEN, SHELLFISH, FISH] },
    ]),
    // priority + warning
    build('k-08', 'Table 14', 'server_assisted', 'preparing', true, 11, [
      { item_name_snapshot: 'Kids Pasta', quantity: 1, modifiers: ['Plain, no sauce'], allergen_tags: [GLUTEN] },
      { item_name_snapshot: 'Apple Juice', quantity: 1, modifiers: [], allergen_tags: [] },
    ]),
    // overdue (>= 15 min) — big multi-item ticket (height stress test)
    build('k-09', 'Table 8', 'server_assisted', 'preparing', false, 17, [
      { item_name_snapshot: 'Mixed Grill Platter', quantity: 1, modifiers: ['Lamb: well done', 'Add halloumi', 'No black pudding'], allergen_tags: [DAIRY, GLUTEN], item_note: 'Birthday — bring out with candle' },
      { item_name_snapshot: 'Garlic Bread', quantity: 2, modifiers: ['One without cheese'], allergen_tags: [GLUTEN, DAIRY] },
      { item_name_snapshot: 'Onion Rings', quantity: 1, modifiers: [], allergen_tags: [GLUTEN] },
      { item_name_snapshot: 'House Red (glass)', quantity: 3, modifiers: [], allergen_tags: [] },
      { item_name_snapshot: 'Side Salad', quantity: 1, modifiers: ['No dressing'], allergen_tags: [] },
    ]),
    // overdue + priority
    build('k-10', 'Table 6', 'diner_self_service', 'preparing', true, 19, [
      { item_name_snapshot: 'Fish & Chips', quantity: 2, modifiers: ['Mushy peas', 'Extra tartare'], allergen_tags: [GLUTEN, FISH, EGG] },
    ]),

    // ── READY (eligible for recall → preparing at any time) ───────────────
    build('k-11', 'Table 2', 'diner_self_service', 'ready', false, 6, [
      { item_name_snapshot: 'Espresso', quantity: 2, modifiers: [], allergen_tags: [] },
      { item_name_snapshot: 'Tiramisu', quantity: 1, modifiers: [], allergen_tags: [GLUTEN, DAIRY, EGG] },
    ]),
    build('k-12', 'Table 10', 'server_assisted', 'ready', false, 10, [
      { item_name_snapshot: 'Chicken Curry', quantity: 1, modifiers: ['Spice: Hot', 'Extra naan'], allergen_tags: [GLUTEN, DAIRY, NUTS, SPICY] },
    ]),
    build('k-13', 'Table 4', 'diner_self_service', 'ready', false, 12, [
      { item_name_snapshot: 'Greek Salad', quantity: 1, modifiers: ['No olives'], allergen_tags: [DAIRY] },
    ]),

    // ── SERVED — inside the 10-min recall window (recallable, still visible) ─
    build('k-14', 'Table 11', 'server_assisted', 'served', false, 18, [
      { item_name_snapshot: 'Beef Tacos', quantity: 3, modifiers: ['Mild'], allergen_tags: [GLUTEN, DAIRY] },
    ], 3),
    build('k-15', 'Table 15', 'diner_self_service', 'served', false, 22, [
      { item_name_snapshot: 'Latte', quantity: 1, modifiers: ['Oat milk'], allergen_tags: [] },
      { item_name_snapshot: 'Croissant', quantity: 1, modifiers: [], allergen_tags: [GLUTEN, DAIRY, EGG] },
    ], 7),

    // ── SERVED — outside the recall window (should be pruned off the board) ─
    build('k-16', 'Table 13', 'diner_self_service', 'served', false, 30, [
      { item_name_snapshot: 'Cappuccino', quantity: 2, modifiers: [], allergen_tags: [DAIRY] },
    ], 14),
    build('k-17', 'Table 16', 'server_assisted', 'served', false, 35, [
      { item_name_snapshot: 'Club Sandwich', quantity: 1, modifiers: ['No tomato'], allergen_tags: [GLUTEN, EGG] },
    ], 20),

    // ── More NEW/PREPARING to fill multiple pages ─────────────────────────
    build('k-18', 'Table 18', 'diner_self_service', 'new', false, 0.2, [
      { item_name_snapshot: 'Iced Tea', quantity: 2, modifiers: ['Lemon'], allergen_tags: [] },
    ]),
    build('k-19', 'Table 20', 'server_assisted', 'preparing', false, 3, [
      { item_name_snapshot: 'Vegan Buddha Bowl', quantity: 1, modifiers: ['Add tofu', 'No tahini'], allergen_tags: [VEGAN, NUTS] },
    ]),
    build('k-20', 'Table 22', 'diner_self_service', 'preparing', false, 13, [
      { item_name_snapshot: 'BBQ Ribs', quantity: 1, modifiers: ['Extra sauce'], allergen_tags: [GLUTEN] },
      { item_name_snapshot: 'Coleslaw', quantity: 1, modifiers: [], allergen_tags: [EGG] },
      { item_name_snapshot: 'Cornbread', quantity: 1, modifiers: [], allergen_tags: [GLUTEN, DAIRY, EGG] },
    ]),
  ];
}

let injectCounter = 0;
/**
 * Builds a brand-new ticket "just arrived" for the dev inject control. Each call
 * yields a fresh id and order number so the board's new-ID diff fires the chime.
 */
export function buildInjectedTicket(): KitchenTicket {
  injectCounter++;
  const id = `k-inj-${Date.now()}-${injectCounter}`;
  return {
    id,
    order_number: 900 + injectCounter,
    table_label: `Table ${10 + (injectCounter % 12)}`,
    order_source: injectCounter % 2 === 0 ? 'server_assisted' : 'diner_self_service',
    fulfilment_status: 'new',
    priority: injectCounter % 3 === 0,
    created_at: new Date().toISOString(),
    served_at: null,
    items: [
      {
        item_name_snapshot: 'Cheeseburger',
        quantity: 1,
        modifiers: ['No pickles', 'Add bacon'],
        allergen_tags: [GLUTEN, DAIRY],
        item_note: injectCounter % 3 === 0 ? 'VIP — rush this' : null,
        extras: [{ item_name_snapshot: 'Extra cheese', quantity: 1, modifiers: [], allergen_tags: [DAIRY] }],
      },
      { item_name_snapshot: 'Fries', quantity: 1, modifiers: [], allergen_tags: [] },
    ],
  };
}
