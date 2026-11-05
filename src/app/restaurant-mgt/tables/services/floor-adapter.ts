/**
 * THE one mapping from floor contract v1 (snake_case, on the wire) to the view model
 * (camelCase). Nothing else in the app reads a `Wire*` type.
 *
 * It CHECKS SHAPE, NEVER BUSINESS STATE. It answers "did the server say something
 * well-formed in contract v1?" and refuses what it cannot read rather than guessing:
 * an unreadable floor is a different fact from an empty one, so the view says so
 * instead of showing a blank floor. It computes nothing the server owns: `stale`,
 * `needs_staff`, `occupied` and `waiting_for_staff` are passed through as sent.
 *
 * ONE EXCEPTION, AND IT IS NARROW (FE-C, decision 2). A table `status` the view does
 * not know is NOT a malformed read: BE-D reports the stored value as stored (D-17), a
 * value outside the five may exist from before PR-5, and refusing the whole floor for
 * one such row would blank the floor for the whole restaurant. The value must still be
 * a STRING; it is kept verbatim (never guessed into one of the five, the D07 rule) and
 * the view reads it as "Status unknown". Every other malformed field still refuses.
 *
 * What BE-D changed from the v1 text, as read here (`docs/FLOOR_CONTRACT.md` in the
 * backend): a released round may carry `released_at: null` (D-4, an order with no
 * placement); `accepted_at_provenance` is read when present (A-3); a command's round
 * may be in any of six states (A-4); every 409 carries `data.round` and a
 * `cannot_be_made` 409 the `cannot_be_made` object (A-5); `restaurant.payment_timing`
 * is `pay_after`, `pay_first` or `null`, never `not_chosen` (D-10); times carry
 * milliseconds and `+03:00` (D-15).
 */
import { toMinorUnits } from '../../../_shared/utils/decimal-money';
import {
  AcceptedAtProvenance,
  COMMAND_ROUND_STATES,
  CannotBeMade,
  CommandRound,
  CommandRoundState,
  FLOOR_CONTRACT,
  FloorRound,
  FloorRoundDetail,
  FloorRoundItem,
  FloorSnapshot,
  FloorTable,
  FloorTableDetail,
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

const ROUND_STATES: readonly RoundState[] = ['held', 'released'];
const ROUND_SOURCES: readonly RoundSource[] = ['diner', 'staff'];
const FULFILMENT: readonly FulfilmentStatus[] = ['new', 'preparing', 'ready', 'served'];
/** D-10: `not_chosen` is a visit's word, never the restaurant's. */
const PAYMENT_TIMINGS: readonly PaymentTiming[] = ['pay_after', 'pay_first'];
const PROVENANCES: readonly AcceptedAtProvenance[] = ['acceptance', 'order_created'];

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

/**
 * The fields every round object carries, with the state read against `states`. The
 * floor lists LIVE rounds only (`held` / `released`); a command answers about a round
 * that may have left the floor (A-4), so it passes the wider list.
 */
function readRoundAs<S extends string>(
  raw: unknown,
  at: string,
  states: readonly S[],
): Omit<FloorRound, 'state'> & { state: S } {
  const r = obj(raw, at);
  const state = oneOf(r['state'], states, `${at}.state`);
  const heldSince = nullableInstant(r['held_since'], `${at}.held_since`);
  const releasedAt = nullableInstant(r['released_at'], `${at}.released_at`);
  // `held_since` is set only for a held round (D-3), and a held round has not been
  // released. `released_at` is NOT required of a released round: a released round with
  // no placement (an order from before Step 1, or accepted with the writer off) has
  // `released_at: null`, because its release was never recorded (D-4).
  if (state === 'held' && (heldSince === null || releasedAt !== null)) fail(`${at}.held`);
  if (state !== 'held' && heldSince !== null) fail(`${at}.held_since.state`);
  const provenance = r['accepted_at_provenance'];
  return {
    orderId: str(r['order_id'], `${at}.order_id`),
    roundNumber: count(r['round_number'], `${at}.round_number`),
    state,
    source: oneOf(r['source'], ROUND_SOURCES, `${at}.source`),
    acceptedAt: instant(r['accepted_at'], `${at}.accepted_at`),
    // Additive (A-3): absent from an older backend, and then unknown rather than invented.
    acceptedAtProvenance:
      provenance === undefined ? null : oneOf(provenance, PROVENANCES, `${at}.accepted_at_provenance`),
    heldSince,
    releasedAt,
    stale: bool(r['stale'], `${at}.stale`),
    fulfilmentStatus: oneOf(r['fulfilment_status'], FULFILMENT, `${at}.fulfilment_status`),
    itemCount: count(r['item_count'], `${at}.item_count`),
    value: money(r['value'], `${at}.value`),
  };
}

function readRound(raw: unknown, i: number): FloorRound {
  return readRoundAs(raw, `rounds[${i}]`, ROUND_STATES);
}

function readCommandRound(raw: unknown, at: string): CommandRound {
  return readRoundAs<CommandRoundState>(raw, at, COMMAND_ROUND_STATES);
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

function readCannotBeMadeAt(raw: unknown, at: string): CannotBeMade | null {
  if (raw === null) return null;
  const c = obj(raw, at);
  return {
    // Kept as a string: the view names the item, and a new classification (D-13) must
    // not refuse a read.
    reason: str(c['reason'], `${at}.reason`),
    itemName: str(c['item_name'], `${at}.item_name`),
  };
}

function readCannotBeMade(raw: unknown, i: number): CannotBeMade | null {
  return readCannotBeMadeAt(raw, `rounds[${i}].cannot_be_made`);
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
    // THE ONE TOLERANCE (decision 2): any STRING is kept verbatim, known or not. A
    // non-string is still malformed and refuses the read.
    status: typeof t['status'] === 'string' ? t['status'] : fail(`tables[${i}].status`),
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
 * commanded: a payload about a different order is refused, never applied. The whole
 * round is read (A-4 states included), because the view takes it as the answer.
 */
export function readCommandOk(raw: unknown, orderId: string): Read<RoundCommandAnswer> {
  return attempt(() => {
    const d = obj(envelopeData(raw), 'data');
    const round = readCommandRound(d['round'], 'round');
    if (round.orderId !== orderId) fail('round.order_id');
    return { kind: 'ok' as const, changed: bool(d['changed'], 'changed'), round };
  });
}

/**
 * Read a 409 body. An unrecognised reason is kept as `unknown` (the round still
 * changed under us; the view says so and refreshes) rather than mistaken for one of
 * the eight it knows.
 *
 * `data.round` (A-5) is read through the same round reader as every other round and
 * must name the commanded order. A body whose round cannot be read, or names another
 * order, still is a refusal — the reason stands — but carries no round, so the view
 * replaces nothing and waits for the re-read instead of guessing.
 */
export function readRefusal(
  body: unknown,
  orderId: string,
): Extract<RoundCommandAnswer, { kind: 'refused' }> {
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const reason = ROUND_REFUSAL_REASONS.includes(b['reason'] as RoundRefusalReason)
    ? (b['reason'] as RoundRefusalReason)
    : 'unknown';
  const itemName = typeof b['item_name'] === 'string' && b['item_name'].trim() ? b['item_name'] : null;
  const state = COMMAND_ROUND_STATES.includes(b['state'] as CommandRoundState)
    ? (b['state'] as CommandRoundState)
    : null;
  const roundRead = attempt(() => {
    const data = obj(b['data'], 'data');
    const round = readCommandRound(data['round'], 'data.round');
    if (round.orderId !== orderId) fail('data.round.order_id');
    return round;
  });
  const cbmRead = attempt(() =>
    b['cannot_be_made'] === undefined ? null : readCannotBeMadeAt(b['cannot_be_made'], 'cannot_be_made'),
  );
  return {
    kind: 'refused',
    reason,
    message: typeof b['message'] === 'string' ? b['message'] : '',
    state,
    itemName: itemName ?? (cbmRead.kind === 'ok' ? cbmRead.value?.itemName ?? null : null),
    round: roundRead.kind === 'ok' ? roundRead.value : null,
    cannotBeMade: cbmRead.kind === 'ok' ? cbmRead.value : null,
  };
}

/**
 * Read the 200 answer to `table-actions/update-status/`: `data` is the table as the
 * server now has it. It must name the table that was commanded and carry the status
 * that was asked for; anything else is not an answer about this action.
 */
export function readStatusOk(raw: unknown, tableId: string, status: string): Read<true> {
  return attempt(() => {
    const d = obj(envelopeData(raw), 'data');
    if (str(d['id'], 'data.id') !== tableId) fail('data.id');
    if (d['status'] !== status) fail('data.status');
    return true as const;
  });
}
