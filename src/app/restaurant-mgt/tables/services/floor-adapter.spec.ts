import { readCommandOk, readFloor, readFloorTable, readRefusal } from './floor-adapter';
import { ROUND_REFUSAL_REASONS } from '../models/floor.models';

/**
 * Floor contract v1, read through the ONE adapter. These fixtures are written in the
 * contract's own shape (snake_case, offsets, decimal strings) so FE-C's transport is
 * held to the same reading.
 */
function round(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: 'o-1',
    round_number: 1,
    state: 'held',
    source: 'diner',
    accepted_at: '2026-11-03T18:58:00+03:00',
    held_since: '2026-11-03T18:58:00+03:00',
    released_at: null,
    stale: false,
    fulfilment_status: 'new',
    item_count: 3,
    value: '16000.00',
    ...over,
  };
}

function table(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-4',
    number: 4,
    display_name: 'T4',
    area_id: null,
    status: 'available',
    occupied: true,
    needs_staff: true,
    visit: { id: 'v-1', opened_at: '2026-11-03T18:50:00+03:00', payment: 'unknown' },
    rounds: [round()],
    ...over,
  };
}

function floor(over: Record<string, unknown> = {}): unknown {
  return {
    status: 200,
    message: 'ok',
    data: {
      contract: 'floor.v1',
      server_time: '2026-11-03T19:02:11+03:00',
      restaurant: { id: 'r-1', accepting_orders: true, payment_timing: 'pay_after' },
      waiting_for_staff: 1,
      tables: [table()],
      ...over,
    },
  };
}

describe('floor-adapter — readFloor (contract v1)', () => {
  it('maps the contract example to the view model, snake_case to camelCase, values verbatim', () => {
    const read = readFloor(floor());
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const f = read.value;
    expect(f.serverTime).toBe('2026-11-03T19:02:11+03:00');
    expect(f.restaurant).toEqual({ id: 'r-1', acceptingOrders: true, paymentTiming: 'pay_after' });
    expect(f.waitingForStaff).toBe(1);
    const t = f.tables[0];
    expect(t.displayName).toBe('T4');
    expect(t.needsStaff).toBeTrue();
    expect(t.visit).toEqual({ id: 'v-1', openedAt: '2026-11-03T18:50:00+03:00', payment: 'unknown' });
    expect(t.rounds[0]).toEqual(
      jasmine.objectContaining({ orderId: 'o-1', heldSince: '2026-11-03T18:58:00+03:00', value: '16000.00' }),
    );
  });

  it('reads an order with no visit as a released round with visit: null', () => {
    const read = readFloor(
      floor({
        tables: [table({
          visit: null,
          needs_staff: false,
          rounds: [round({ state: 'released', held_since: null, released_at: '2026-11-03T18:59:00+03:00' })],
        })],
      }),
    );
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.value.tables[0].visit).toBeNull();
  });

  const refusals: [string, unknown][] = [
    ['another contract tag', floor({ contract: 'floor.v2' })],
    ['a naive timestamp (no offset)', floor({ server_time: '2026-11-03T19:02:11' })],
    ['money as a float', floor({ tables: [table({ rounds: [round({ value: 16000 })] })] })],
    ['money with three decimals', floor({ tables: [table({ rounds: [round({ value: '16000.005' })] })] })],
    ['a negative value', floor({ tables: [table({ rounds: [round({ value: '-1.00' })] })] })],
    ['a payment other than "unknown"', floor({ tables: [table({ visit: { id: 'v', opened_at: '2026-11-03T18:50:00+03:00', payment: 'paid' } })] })],
    ['a held round with no held_since', floor({ tables: [table({ rounds: [round({ held_since: null })] })] })],
    ['a released round with no released_at', floor({ tables: [table({ rounds: [round({ state: 'released', held_since: null })] })] })],
    ['a round state outside the list', floor({ tables: [table({ rounds: [round({ state: 'declined' })] })] })],
    ['an unknown table status', floor({ tables: [table({ status: 'reserved' })] })],
    ['a missing visit key', floor({ tables: [(() => { const t = table(); delete t['visit']; return t; })()] })],
    ['a refusal envelope on a 2xx', { status: 409, message: 'no', reason: 'round_declined', data: {} }],
    ['a list that is not an array', floor({ tables: { 0: table() } })],
  ];
  for (const [label, raw] of refusals) {
    it(`refuses ${label} rather than guessing`, () => {
      expect(readFloor(raw).kind).toBe('invalid');
    });
  }
});

describe('floor-adapter — readFloorTable', () => {
  function detail(over: Record<string, unknown> = {}): unknown {
    return {
      status: 200,
      message: 'ok',
      data: table({
        rounds: [round({
          items: [{ name: 'Rolex', quantity: 2, extras: [{ name: 'Avocado', quantity: 1 }], modifiers: ['No onion'], note: null }],
          cannot_be_made: { reason: 'item_sold_out', item_name: 'Rolex' },
        })],
        ...over,
      }),
    };
  }

  it('reads items and cannot_be_made', () => {
    const read = readFloorTable(detail(), 't-4');
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const r = read.value.rounds[0];
    expect(r.items[0]).toEqual({ name: 'Rolex', quantity: 2, extras: [{ name: 'Avocado', quantity: 1 }], modifiers: ['No onion'], note: null });
    expect(r.cannotBeMade).toEqual({ reason: 'item_sold_out', itemName: 'Rolex' });
  });

  it('refuses an answer about a different table', () => {
    expect(readFloorTable(detail(), 't-9').kind).toBe('invalid');
  });

  it('refuses cannot_be_made on a released round (it is only set on a held one)', () => {
    const raw = {
      status: 200,
      message: 'ok',
      data: table({
        rounds: [round({
          state: 'released', held_since: null, released_at: '2026-11-03T18:59:00+03:00',
          items: [], cannot_be_made: { reason: 'item_sold_out', item_name: 'Rolex' },
        })],
      }),
    };
    expect(readFloorTable(raw, 't-4').kind).toBe('invalid');
  });

  it('refuses a round with no cannot_be_made key (null is an answer; absence is not)', () => {
    const raw = { status: 200, message: 'ok', data: table({ rounds: [round({ items: [] })] }) };
    expect(readFloorTable(raw, 't-4').kind).toBe('invalid');
  });
});

describe('floor-adapter — command answers', () => {
  it('reads a 200 that names the commanded round', () => {
    const read = readCommandOk(
      { status: 200, message: 'ok', data: { round: { order_id: 'o-1', state: 'released' }, changed: true } },
      'o-1',
    );
    expect(read).toEqual({ kind: 'ok', value: { kind: 'ok', changed: true, orderId: 'o-1', state: 'released' } });
  });

  it('refuses a 200 about a different order — it is never applied to this one', () => {
    const read = readCommandOk(
      { status: 200, message: 'ok', data: { round: { order_id: 'o-2', state: 'released' }, changed: true } },
      'o-1',
    );
    expect(read.kind).toBe('invalid');
  });

  for (const reason of ROUND_REFUSAL_REASONS) {
    it(`keeps the 409 reason ${reason} and the round's current state`, () => {
      const r = readRefusal({ status: 409, message: 'm', reason, state: 'held', item_name: 'Rolex' });
      expect(r.reason).toBe(reason);
      expect(r.state).toBe('held');
      expect(r.itemName).toBe('Rolex');
    });
  }

  it('reads an unrecognised reason as unknown, never as one of the eight', () => {
    expect(readRefusal({ status: 409, reason: 'table_on_fire', state: 'held' }).reason).toBe('unknown');
    expect(readRefusal('not a body').reason).toBe('unknown');
  });
});
