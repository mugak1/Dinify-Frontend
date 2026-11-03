/**
 * Sample floor for the Step 2 floor view (mock only; FE-C replaces it with the real
 * floor endpoints). Times are MINUTES BEFORE the mock's clock, so ages read the same
 * whenever the preview is opened.
 *
 * Every state the view has to draw appears at least once:
 *   T1  free table
 *   T2  held round, fresh                          (needs staff)
 *   T3  held round, stale (held 22 min)             (needs staff)
 *   T4  held round that cannot be made (sold out)   (needs staff)
 *   T5  two released rounds (ready, preparing)
 *   T6  released round with NO visit, on a table whose floor status is still
 *       "available" — occupancy comes from orders, never from Table.status
 *   T7  dirty
 *   T8  out of service
 *   T9  a released round and a fresh held round      (needs staff)
 *   T10 bill requested, one released round placed by staff
 *
 * Prices are UGX and every round value is the exact sum of its lines.
 */
import { FloorTableStatus, FulfilmentStatus, RoundSource, WireRoundItem } from '../models/floor.models';

export interface MockRoundSeed {
  orderId: string;
  roundNumber: number;
  state: 'held' | 'released';
  source: RoundSource;
  acceptedMinAgo: number;
  /** Held rounds: minutes since held. Released rounds: minutes since released. */
  sinceMinAgo: number;
  fulfilmentStatus: FulfilmentStatus;
  items: WireRoundItem[];
  value: string;
  /** Mock-only: the item that would fail the release makeability check. */
  cannotBeMadeItem?: string;
}

export interface MockTableSeed {
  id: string;
  number: number;
  displayName: string;
  areaId: string | null;
  status: FloorTableStatus;
  /** Mock-only: the table's QR is menu-only, so diner rounds are refused. */
  menuOnly?: boolean;
  visitOpenedMinAgo: number | null;
  rounds: MockRoundSeed[];
}

const AREA_MAIN = '7a1d0c55-0000-4000-8000-00000000a001';
const AREA_TERRACE = '7a1d0c55-0000-4000-8000-00000000a002';

const tableId = (n: number) => `7a1d0c55-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const orderId = (n: number, r: number) => `7a1d0c55-0000-4000-8000-00000000${String(n).padStart(2, '0')}${String(r).padStart(2, '0')}`;

const item = (
  name: string,
  quantity: number,
  extras: { name: string; quantity: number }[] = [],
  modifiers: string[] = [],
  note: string | null = null,
): WireRoundItem => ({ name, quantity, extras, modifiers, note });

export const MOCK_FLOOR_TABLES: MockTableSeed[] = [
  { id: tableId(1), number: 1, displayName: 'T1', areaId: AREA_MAIN, status: 'available', visitOpenedMinAgo: null, rounds: [] },
  {
    id: tableId(2), number: 2, displayName: 'T2', areaId: AREA_MAIN, status: 'seated', visitOpenedMinAgo: 9,
    rounds: [{
      orderId: orderId(2, 1), roundNumber: 1, state: 'held', source: 'diner', acceptedMinAgo: 4, sinceMinAgo: 4,
      fulfilmentStatus: 'new',
      // 2 × 7,000 + 1 × 1,000 avocado + 1 × 2,000 tea
      items: [
        item('Rolex', 2, [{ name: 'Avocado', quantity: 1 }], ['No onion']),
        item('African tea', 1, [], [], 'Less sugar'),
      ],
      value: '17000.00',
    }],
  },
  {
    id: tableId(3), number: 3, displayName: 'T3', areaId: AREA_MAIN, status: 'seated', visitOpenedMinAgo: 31,
    rounds: [{
      orderId: orderId(3, 1), roundNumber: 1, state: 'held', source: 'diner', acceptedMinAgo: 22, sinceMinAgo: 22,
      fulfilmentStatus: 'new',
      // 32,000 + 2 × 6,000
      items: [item('Grilled tilapia', 1, [], ['Well done']), item('Chips', 2)],
      value: '44000.00',
    }],
  },
  {
    id: tableId(4), number: 4, displayName: 'T4', areaId: AREA_MAIN, status: 'seated', visitOpenedMinAgo: 12,
    rounds: [{
      orderId: orderId(4, 1), roundNumber: 1, state: 'held', source: 'diner', acceptedMinAgo: 6, sinceMinAgo: 6,
      fulfilmentStatus: 'new',
      // 25,000 + 8,000
      items: [item('Chicken luwombo', 1), item('Matooke', 1)],
      value: '33000.00',
      cannotBeMadeItem: 'Chicken luwombo',
    }],
  },
  {
    id: tableId(5), number: 5, displayName: 'T5', areaId: AREA_TERRACE, status: 'seated', visitOpenedMinAgo: 48,
    rounds: [
      {
        orderId: orderId(5, 1), roundNumber: 1, state: 'released', source: 'diner', acceptedMinAgo: 45, sinceMinAgo: 40,
        fulfilmentStatus: 'ready',
        // 4 × 2,000 + 2 × 4,000
        items: [item('Samosa', 4), item('Passion juice', 2)],
        value: '16000.00',
      },
      {
        orderId: orderId(5, 2), roundNumber: 2, state: 'released', source: 'diner', acceptedMinAgo: 12, sinceMinAgo: 10,
        fulfilmentStatus: 'preparing',
        // 2 × 15,000
        items: [item('Pilau', 2)],
        value: '30000.00',
      },
    ],
  },
  {
    id: tableId(6), number: 6, displayName: 'T6', areaId: AREA_TERRACE, status: 'available', visitOpenedMinAgo: null,
    rounds: [{
      orderId: orderId(6, 1), roundNumber: 1, state: 'released', source: 'diner', acceptedMinAgo: 25, sinceMinAgo: 25,
      fulfilmentStatus: 'preparing',
      // 3 × 1,500 + 6,000
      items: [item('Chapati', 3), item('Beans', 1)],
      value: '10500.00',
    }],
  },
  { id: tableId(7), number: 7, displayName: 'T7', areaId: AREA_TERRACE, status: 'dirty', visitOpenedMinAgo: null, rounds: [] },
  { id: tableId(8), number: 8, displayName: 'T8', areaId: AREA_TERRACE, status: 'out_of_service', visitOpenedMinAgo: null, rounds: [] },
  {
    id: tableId(9), number: 9, displayName: 'T9', areaId: AREA_MAIN, status: 'seated', visitOpenedMinAgo: 35,
    rounds: [
      {
        orderId: orderId(9, 1), roundNumber: 1, state: 'released', source: 'diner', acceptedMinAgo: 30, sinceMinAgo: 28,
        fulfilmentStatus: 'ready',
        // 2 × 6,000
        items: [item('Nile Special', 2)],
        value: '12000.00',
      },
      {
        orderId: orderId(9, 2), roundNumber: 2, state: 'held', source: 'diner', acceptedMinAgo: 2, sinceMinAgo: 2,
        fulfilmentStatus: 'new',
        // 2 × 12,000
        items: [item('Beef stew', 2)],
        value: '24000.00',
      },
    ],
  },
  {
    id: tableId(10), number: 10, displayName: 'T10', areaId: AREA_MAIN, status: 'bill_requested', visitOpenedMinAgo: 55,
    rounds: [{
      orderId: orderId(10, 1), roundNumber: 1, state: 'released', source: 'staff', acceptedMinAgo: 50, sinceMinAgo: 50,
      fulfilmentStatus: 'ready',
      // 2 × 18,000
      items: [item('Goat stew', 2)],
      value: '36000.00',
    }],
  },
];

/** Ids the specs refer to by name. */
export const MOCK_FLOOR_IDS = {
  freeTable: tableId(1),
  freshHeldTable: tableId(2),
  freshHeldRound: orderId(2, 1),
  staleHeldTable: tableId(3),
  staleHeldRound: orderId(3, 1),
  cannotBeMadeTable: tableId(4),
  cannotBeMadeRound: orderId(4, 1),
  releasedTable: tableId(5),
  noVisitTable: tableId(6),
  dirtyTable: tableId(7),
  outOfServiceTable: tableId(8),
  mixedTable: tableId(9),
  mixedHeldRound: orderId(9, 2),
  billTable: tableId(10),
} as const;
