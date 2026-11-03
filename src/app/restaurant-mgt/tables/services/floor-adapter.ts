/**
 * THE one mapping from floor contract v1 (snake_case, on the wire) to the view model
 * (camelCase). Nothing else in the app reads a `Wire*` type.
 *
 * It CHECKS SHAPE, NEVER BUSINESS STATE. It answers "did the server say something
 * well-formed in contract v1?" and refuses what it cannot read rather than guessing:
 * an unreadable floor is a different fact from an empty one, so the view says so
 * instead of showing a blank floor. It computes nothing the server owns: `stale`,
 * `needs_staff`, `occupied` and `waiting_for_staff` are passed through as sent.
 */
import { toMinorUnits } from '../../../_shared/utils/decimal-money';
import {
  CannotBeMade,
  FLOOR_CONTRACT,
  FloorRound,
  FloorRoundDetail,
  FloorRoundItem,
  FloorSnapshot,
  FloorTable,
  FloorTableDetail,
  FloorTableStatus,
  FloorVisit,
  FulfilmentStatus,
  PaymentTiming,
  ROUND_REFUSAL_REASONS,
  RoundCommandAnswer,
  RoundRefusalReason,
  RoundSource,
  RoundState,
} from '../models/floor.models';

export type Read<T> = { kind: 'ok'; value: T } | { kind: 'invalid'; why: string };

const TABLE_STATUSES: readonly FloorTableStatus[] = [
  'available',
  'seated',
  'bill_requested',
  'dirty',
  'out_of_service',
];
const ROUND_STATES: readonly RoundState[] = ['held', 'released'];
const ROUND_SOURCES: readonly RoundSource[] = ['diner', 'staff'];
const FULFILMENT: readonly FulfilmentStatus[] = ['new', 'preparing', 'ready', 'served'];
const PAYMENT_TIMINGS: readonly PaymentTiming[] = ['pay_after', 'pay_first', 'not_chosen'];

/** ISO 8601 WITH an offset. A naive timestamp would be read against the device's zone. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

class Invalid extends Error {}

function fail(why: string): never {
  throw new Invalid(why);
}

function obj(v: unknown, why: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(why);
  return v as Record<string, unknown>;
}

function str(v: unknown, why: string): string {
  if (typeof v !== 'string' || v.trim() === '') fail(why);
  return v as string;
}

function bool(v: unknown, why: string): boolean {
  if (typeof v !== 'boolean') fail(why);
  return v as boolean;
}

function count(v: unknown, why: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(why);
  return v as number;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], why: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(why);
  return v as T;
}

function instant(v: unknown, why: string): string {
  if (typeof v !== 'string' || !ISO_WITH_OFFSET.test(v) || !Number.isFinite(Date.parse(v))) fail(why);
  return v as string;
}

function nullableInstant(v: unknown, why: string): string | null {
  return v === null ? null : instant(v, why);
}

/** A non-negative canonical decimal string. Money is never a float on this wire. */
function money(v: unknown, why: string): string {
  if (typeof v !== 'string') fail(why);
  const minor = toMinorUnits(v);
  if (minor === null || minor < 0) fail(why);
  return v as string;
}

function list<T>(v: unknown, why: string, each: (x: unknown, i: number) => T): T[] {
  if (!Array.isArray(v)) fail(why);
  return (v as unknown[]).map(each);
}

/** Unwrap `{status, message, data}`; a body carrying `reason` is a refusal, not data. */
function envelopeData(raw: unknown): unknown {
  const env = obj(raw, 'envelope');
  if (env['reason'] !== undefined) fail('refusal-envelope');
  if (!('data' in env)) fail('envelope.data');
  return env['data'];
}

function readRound(raw: unknown, i: number): FloorRound {
  const r = obj(raw, `rounds[${i}]`);
  const state = oneOf(r['state'], ROUND_STATES, `rounds[${i}].state`);
  const heldSince = nullableInstant(r['held_since'], `rounds[${i}].held_since`);
  const releasedAt = nullableInstant(r['released_at'], `rounds[${i}].released_at`);
  // The contract ties each timestamp to one state; a round carrying the other one is
  // not something this view can place.
  if (state === 'held' && (heldSince === null || releasedAt !== null)) fail(`rounds[${i}].held`);
  if (state === 'released' && (releasedAt === null || heldSince !== null)) fail(`rounds[${i}].released`);
  return {
    orderId: str(r['order_id'], `rounds[${i}].order_id`),
    roundNumber: count(r['round_number'], `rounds[${i}].round_number`),
    state,
    source: oneOf(r['source'], ROUND_SOURCES, `rounds[${i}].source`),
    acceptedAt: instant(r['accepted_at'], `rounds[${i}].accepted_at`),
    heldSince,
    releasedAt,
    stale: bool(r['stale'], `rounds[${i}].stale`),
    fulfilmentStatus: oneOf(r['fulfilment_status'], FULFILMENT, `rounds[${i}].fulfilment_status`),
    itemCount: count(r['item_count'], `rounds[${i}].item_count`),
    value: money(r['value'], `rounds[${i}].value`),
  };
}

function readItem(raw: unknown, i: number): FloorRoundItem {
  const it = obj(raw, `items[${i}]`);
  const note = it['note'];
  if (note !== null && typeof note !== 'string') fail(`items[${i}].note`);
  return {
    name: str(it['name'], `items[${i}].name`),
    quantity: count(it['quantity'], `items[${i}].quantity`),
    extras: list(it['extras'], `items[${i}].extras`, (x, j) => {
      const e = obj(x, `items[${i}].extras[${j}]`);
      return {
        name: str(e['name'], `items[${i}].extras[${j}].name`),
        quantity: count(e['quantity'], `items[${i}].extras[${j}].quantity`),
      };
    }),
    modifiers: list(it['modifiers'], `items[${i}].modifiers`, (m, j) =>
      str(m, `items[${i}].modifiers[${j}]`),
    ),
    note: (note as string | null) ?? null,
  };
}

function readCannotBeMade(raw: unknown, i: number): CannotBeMade | null {
  if (raw === null) return null;
  const c = obj(raw, `rounds[${i}].cannot_be_made`);
  return {
    reason: str(c['reason'], `rounds[${i}].cannot_be_made.reason`),
    itemName: str(c['item_name'], `rounds[${i}].cannot_be_made.item_name`),
  };
}

function readRoundDetail(raw: unknown, i: number): FloorRoundDetail {
  const round = readRound(raw, i);
  const r = obj(raw, `rounds[${i}]`);
  // `null` is a real answer ("it can be made"); an ABSENT key is not one.
  if (r['cannot_be_made'] === undefined) fail(`rounds[${i}].cannot_be_made`);
  const cannotBeMade = readCannotBeMade(r['cannot_be_made'], i);
  // `cannot_be_made` is null unless the round is HELD and fails the makeability check.
  if (cannotBeMade && round.state !== 'held') fail(`rounds[${i}].cannot_be_made.state`);
  return { ...round, items: list(r['items'], `rounds[${i}].items`, readItem), cannotBeMade };
}

function readVisit(raw: unknown): FloorVisit | null {
  if (raw === null) return null;
  const v = obj(raw, 'visit');
  return {
    id: str(v['id'], 'visit.id'),
    openedAt: instant(v['opened_at'], 'visit.opened_at'),
    // The one payment value the contract allows. Anything else is a claim this view
    // will not render.
    payment: oneOf(v['payment'], ['unknown'] as const, 'visit.payment'),
  };
}

function readTableShell(raw: unknown, i: number): Omit<FloorTable, 'rounds'> {
  const t = obj(raw, `tables[${i}]`);
  const areaId = t['area_id'];
  if (areaId !== null && (typeof areaId !== 'string' || areaId === '')) fail(`tables[${i}].area_id`);
  return {
    id: str(t['id'], `tables[${i}].id`),
    number: count(t['number'], `tables[${i}].number`),
    displayName: str(t['display_name'], `tables[${i}].display_name`),
    areaId: areaId as string | null,
    status: oneOf(t['status'], TABLE_STATUSES, `tables[${i}].status`),
    occupied: bool(t['occupied'], `tables[${i}].occupied`),
    needsStaff: bool(t['needs_staff'], `tables[${i}].needs_staff`),
    visit: readVisit(t['visit'] === undefined ? fail(`tables[${i}].visit`) : t['visit']),
  };
}

function readTable(raw: unknown, i: number): FloorTable {
  const t = obj(raw, `tables[${i}]`);
  return { ...readTableShell(raw, i), rounds: list(t['rounds'], `tables[${i}].rounds`, readRound) };
}

function attempt<T>(read: () => T): Read<T> {
  try {
    return { kind: 'ok', value: read() };
  } catch (e) {
    if (e instanceof Invalid) return { kind: 'invalid', why: e.message };
    throw e;
  }
}

/** Read `GET floor/?restaurant=`. */
export function readFloor(raw: unknown): Read<FloorSnapshot> {
  return attempt(() => {
    const d = obj(envelopeData(raw), 'data');
    if (d['contract'] !== FLOOR_CONTRACT) fail('contract');
    const r = obj(d['restaurant'], 'restaurant');
    const timing = r['payment_timing'];
    return {
      contract: FLOOR_CONTRACT,
      serverTime: instant(d['server_time'], 'server_time'),
      restaurant: {
        id: str(r['id'], 'restaurant.id'),
        acceptingOrders: bool(r['accepting_orders'], 'restaurant.accepting_orders'),
        paymentTiming: timing === null ? null : oneOf(timing, PAYMENT_TIMINGS, 'restaurant.payment_timing'),
      },
      waitingForStaff: count(d['waiting_for_staff'], 'waiting_for_staff'),
      tables: list(d['tables'], 'tables', readTable),
    };
  });
}

/** Read `GET floor/tables/<id>/?restaurant=` — the same table object, with items. */
export function readFloorTable(raw: unknown, expectedTableId: string): Read<FloorTableDetail> {
  return attempt(() => {
    const d = envelopeData(raw);
    const t = obj(d, 'data');
    const shell = readTableShell(t, 0);
    // An answer about a different table is not an answer about this one.
    if (shell.id !== expectedTableId) fail('table.id');
    return { ...shell, rounds: list(t['rounds'], 'rounds', readRoundDetail) };
  });
}

/**
 * Read the 200 answer to confirm or decline. It must name the round that was
 * commanded: a payload about a different order is refused, never applied.
 */
export function readCommandOk(raw: unknown, orderId: string): Read<RoundCommandAnswer> {
  return attempt(() => {
    const d = obj(envelopeData(raw), 'data');
    const round = obj(d['round'], 'round');
    const answered = str(round['order_id'], 'round.order_id');
    if (answered !== orderId) fail('round.order_id');
    return {
      kind: 'ok' as const,
      changed: bool(d['changed'], 'changed'),
      orderId: answered,
      state: str(round['state'], 'round.state'),
    };
  });
}

/**
 * Read a 409 body. An unrecognised reason is kept as `unknown` (the round still
 * changed under us; the view says so and refreshes) rather than mistaken for one of
 * the eight it knows.
 */
export function readRefusal(body: unknown): Extract<RoundCommandAnswer, { kind: 'refused' }> {
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const reason = ROUND_REFUSAL_REASONS.includes(b['reason'] as RoundRefusalReason)
    ? (b['reason'] as RoundRefusalReason)
    : 'unknown';
  const itemName = typeof b['item_name'] === 'string' && b['item_name'].trim() ? b['item_name'] : null;
  return {
    kind: 'refused',
    reason,
    message: typeof b['message'] === 'string' ? b['message'] : '',
    state: typeof b['state'] === 'string' ? b['state'] : null,
    itemName,
  };
}
