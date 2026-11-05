import { readCommandOk, readFloor, readFloorTable, readRefusal, readStatusOk } from './floor-adapter';
import { COMMAND_ROUND_STATES, ROUND_REFUSAL_REASONS } from '../models/floor.models';

/**
 * Floor contract v1, read through the ONE adapter. The fixtures are written in the
 * shape BE-D actually sends (`docs/FLOOR_CONTRACT.md` in the backend, including what
 * BE-D defined, clarified or changed): snake_case, times in `+03:00` to the
 * MILLISECOND (D-15), money as a decimal string, `accepted_at_provenance` (A-3).
 */
const T = (hhmm: string) => `2026-11-03T${hhmm}:00.000+03:00`;

function round(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: 'o-1',
    round_number: 1,
    state: 'held',
    source: 'diner',
    accepted_at: T('18:58'),
    accepted_at_provenance: 'acceptance',
    held_since: T('18:58'),
    released_at: null,
    stale: false,
    fulfilment_status: 'new',
    item_count: 3,
    value: '16000.00',
    ...over,
  };
}

const released = (over: Record<string, unknown> = {}) =>
  round({ state: 'released', held_since: null, released_at: T('18:59'), ...over });

function table(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-4',
    number: 4,
    display_name: 'T4',
    area_id: null,
    status: 'available',
    occupied: true,
    needs_staff: true,
    visit: { id: 'v-1', opened_at: T('18:50'), payment: 'unknown' },
    rounds: [round()],
    ...over,
  };
}

function floor(over: Record<string, unknown> = {}): unknown {
  return {
    status: 200,
    message: 'Floor retrieved',
    data: {
      contract: 'floor.v1',
      server_time: '2026-11-03T19:02:11.000+03:00',
      restaurant: { id: 'r-1', accepting_orders: true, payment_timing: 'pay_after' },
      waiting_for_staff: 1,
      tables: [table()],
      ...over,
    },
  };
}

describe('floor-adapter — readFloor (contract v1, as BE-D shipped it)', () => {
  it('maps the contract example to the view model, snake_case to camelCase, values verbatim', () => {
    const read = readFloor(floor());
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const f = read.value;
    expect(f.serverTime).toBe('2026-11-03T19:02:11.000+03:00');
    expect(f.restaurant).toEqual({ id: 'r-1', acceptingOrders: true, paymentTiming: 'pay_after' });
    expect(f.waitingForStaff).toBe(1);
    const t = f.tables[0];
    expect(t.displayName).toBe('T4');
    expect(t.needsStaff).toBeTrue();
    expect(t.visit).toEqual({ id: 'v-1', openedAt: T('18:50'), payment: 'unknown' });
    expect(t.rounds[0]).toEqual(
      jasmine.objectContaining({
        orderId: 'o-1', heldSince: T('18:58'), value: '16000.00', acceptedAtProvenance: 'acceptance',
      }),
    );
  });

  it('D-15: reads times to the millisecond in +03:00, and still reads them without milliseconds', () => {
    const read = readFloor(floor({ server_time: '2026-11-03T19:02:11.123+03:00' }));
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') expect(read.value.serverTime).toBe('2026-11-03T19:02:11.123+03:00');
    expect(readFloor(floor({ server_time: '2026-11-03T19:02:11+03:00' })).kind).toBe('ok');
  });

  it('D-10: payment_timing is pay_after, pay_first or null', () => {
    for (const timing of ['pay_after', 'pay_first', null]) {
      const read = readFloor(floor({ restaurant: { id: 'r-1', accepting_orders: true, payment_timing: timing } }));
      expect(read.kind).withContext(String(timing)).toBe('ok');
      if (read.kind === 'ok') expect(read.value.restaurant.paymentTiming).toBe(timing as never);
    }
  });

  it('A-3: accepted_at_provenance "order_created" is read; an older backend that omits it reads null', () => {
    const t = table({ rounds: [round({ accepted_at_provenance: 'order_created' })] });
    const read = readFloor(floor({ tables: [t] }));
    expect(read.kind === 'ok' && read.value.tables[0].rounds[0].acceptedAtProvenance).toBe('order_created');
    const legacy = round();
    delete legacy['accepted_at_provenance'];
    const old = readFloor(floor({ tables: [table({ rounds: [legacy] })] }));
    expect(old.kind === 'ok' && old.value.tables[0].rounds[0].acceptedAtProvenance).toBeNull();
  });

  it('D-4: a released round with NO placement carries released_at: null and visit: null, and is read', () => {
    const read = readFloor(
      floor({ tables: [table({ visit: null, needs_staff: false, rounds: [released({ released_at: null })] })] }),
    );
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.value.tables[0].visit).toBeNull();
    expect(read.value.tables[0].rounds[0]).toEqual(
      jasmine.objectContaining({ state: 'released', releasedAt: null, heldSince: null }),
    );
  });

  describe('DECISION 2: an unknown table status is ONE table’s problem, not the floor’s', () => {
    it('keeps the unknown value VERBATIM and reads every other table as usual', () => {
      const read = readFloor(
        floor({
          tables: [
            table({ id: 't-1', number: 1, display_name: 'T1', status: 'reserved' }),
            table({ id: 't-2', number: 2, display_name: 'T2', status: 'dirty', rounds: [], occupied: false, needs_staff: false, visit: null }),
          ],
        }),
      );
      expect(read.kind).toBe('ok');
      if (read.kind !== 'ok') return;
      expect(read.value.tables.map(t => t.status)).toEqual(['reserved', 'dirty']);
      // The table with the unknown status keeps its rounds, untouched.
      expect(read.value.tables[0].rounds.length).toBe(1);
    });

    it('an empty stored status is kept too, never guessed', () => {
      const read = readFloor(floor({ tables: [table({ status: '' })] }));
      expect(read.kind === 'ok' && read.value.tables[0].status).toBe('');
    });

    it('the drawer read keeps it as well', () => {
      const raw = { status: 200, message: 'ok', data: table({ status: 'closed', rounds: [round({ items: [], cannot_be_made: null })] }) };
      const read = readFloorTable(raw, 't-4');
      expect(read.kind === 'ok' && read.value.status).toBe('closed');
    });

    it('but a status that is not a string is malformed, and refuses the read', () => {
      for (const status of [null, 3, true, {}, ['dirty']]) {
        expect(readFloor(floor({ tables: [table({ status })] })).kind).withContext(JSON.stringify(status)).toBe('invalid');
      }
      const missing = table();
      delete missing['status'];
      expect(readFloor(floor({ tables: [missing] })).kind).toBe('invalid');
    });
  });

  const refusals: [string, unknown][] = [
    ['another contract tag', floor({ contract: 'floor.v2' })],
    ['a naive timestamp (no offset)', floor({ server_time: '2026-11-03T19:02:11.000' })],
    ['money as a float', floor({ tables: [table({ rounds: [round({ value: 16000 })] })] })],
    ['money with three decimals', floor({ tables: [table({ rounds: [round({ value: '16000.005' })] })] })],
    ['a negative value', floor({ tables: [table({ rounds: [round({ value: '-1.00' })] })] })],
    ['a payment other than "unknown"', floor({ tables: [table({ visit: { id: 'v', opened_at: T('18:50'), payment: 'paid' } })] })],
    ['a held round with no held_since', floor({ tables: [table({ rounds: [round({ held_since: null })] })] })],
    ['a held round with a released_at', floor({ tables: [table({ rounds: [round({ released_at: T('18:59') })] })] })],
    ['a released round carrying held_since', floor({ tables: [table({ rounds: [released({ held_since: T('18:58') })] })] })],
    ['a round state outside the floor list (only live rounds are listed)', floor({ tables: [table({ rounds: [round({ state: 'declined', held_since: null })] })] })],
    ['an unknown accepted_at_provenance', floor({ tables: [table({ rounds: [round({ accepted_at_provenance: 'guess' })] })] })],
    ['D-10: payment_timing "not_chosen" at the restaurant level', floor({ restaurant: { id: 'r-1', accepting_orders: true, payment_timing: 'not_chosen' } })],
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

describe('floor-adapter — readFloorTable (D-14: data is the table object itself)', () => {
  function detail(over: Record<string, unknown> = {}): unknown {
    return {
      status: 200,
      message: 'Table retrieved',
      data: table({
        rounds: [round({
          // D-12: the snapshot as saved, "Group: choice".
          items: [{ name: 'Rolex', quantity: 2, extras: [{ name: 'Avocado', quantity: 1 }], modifiers: ['Onion: No onion'], note: null }],
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
    expect(r.items[0]).toEqual({ name: 'Rolex', quantity: 2, extras: [{ name: 'Avocado', quantity: 1 }], modifiers: ['Onion: No onion'], note: null });
    expect(r.cannotBeMade).toEqual({ reason: 'item_sold_out', itemName: 'Rolex' });
  });

  it('D-13: a makeability classification it has not seen is kept, not refused', () => {
    const raw = {
      status: 200, message: 'ok',
      data: table({ rounds: [round({ items: [], cannot_be_made: { reason: 'modifier_selection_meaning_changed', item_name: 'Rolex' } })] }),
    };
    const read = readFloorTable(raw, 't-4');
    expect(read.kind === 'ok' && read.value.rounds[0].cannotBeMade?.reason).toBe('modifier_selection_meaning_changed');
  });

  it('refuses an answer about a different table', () => {
    expect(readFloorTable(detail(), 't-9').kind).toBe('invalid');
  });

  it('refuses cannot_be_made on a released round (it is only set on a held one)', () => {
    const raw = {
      status: 200,
      message: 'ok',
      data: table({ rounds: [released({ items: [], cannot_be_made: { reason: 'item_sold_out', item_name: 'Rolex' } })] }),
    };
    expect(readFloorTable(raw, 't-4').kind).toBe('invalid');
  });

  it('refuses a round with no cannot_be_made key (null is an answer; absence is not)', () => {
    const raw = { status: 200, message: 'ok', data: table({ rounds: [round({ items: [] })] }) };
    expect(readFloorTable(raw, 't-4').kind).toBe('invalid');
  });
});

describe('floor-adapter — command answers', () => {
  /** A-4: the round a command answers about, in any of the six states. */
  function commandRound(state: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return round({
      state,
      held_since: state === 'held' ? T('18:58') : null,
      released_at: state === 'released' ? T('19:00') : null,
      ...over,
    });
  }

  it('reads a 200 that names the commanded round, and keeps the whole round', () => {
    const read = readCommandOk(
      { status: 200, message: 'Order sent to the kitchen', data: { round: commandRound('released'), changed: true } },
      'o-1',
    );
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok' || read.value.kind !== 'ok') return fail('not ok');
    expect(read.value.changed).toBeTrue();
    expect(read.value.round).toEqual(jasmine.objectContaining({ orderId: 'o-1', state: 'released', releasedAt: T('19:00') }));
  });

  for (const state of COMMAND_ROUND_STATES) {
    it(`A-4: a command's round may be "${state}"`, () => {
      const read = readCommandOk({ status: 200, message: 'm', data: { round: commandRound(state), changed: false } }, 'o-1');
      expect(read.kind === 'ok' && read.value.kind === 'ok' && read.value.round.state).toBe(state as never);
    });
  }

  it('a successful Decline answers state "declined"', () => {
    const read = readCommandOk({ status: 200, message: 'Order declined', data: { round: commandRound('declined'), changed: true } }, 'o-1');
    expect(read.kind === 'ok' && read.value.kind === 'ok' && read.value.round.state).toBe('declined');
  });

  it('refuses a 200 about a different order — it is never applied to this one', () => {
    const read = readCommandOk({ status: 200, message: 'ok', data: { round: commandRound('released', { order_id: 'o-2' }), changed: true } }, 'o-1');
    expect(read.kind).toBe('invalid');
  });

  it('refuses a 200 whose round is malformed or in a state outside the six', () => {
    for (const r of [commandRound('lost'), commandRound('released', { value: 1 }), { order_id: 'o-1', state: 'released' }]) {
      expect(readCommandOk({ status: 200, message: 'ok', data: { round: r, changed: true } }, 'o-1').kind).toBe('invalid');
    }
  });

  /** The kitchen-style conflict envelope (A-5). */
  function conflict(reason: string, state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { status: 409, message: 'm', reason, state, ...extra, data: { round: commandRound(state) } };
  }

  for (const reason of ROUND_REFUSAL_REASONS) {
    it(`A-5: keeps the 409 reason ${reason}, the round's state and data.round`, () => {
      const r = readRefusal(conflict(reason, 'held'), 'o-1');
      expect(r.reason).toBe(reason);
      expect(r.state).toBe('held');
      expect(r.round).toEqual(jasmine.objectContaining({ orderId: 'o-1', state: 'held', heldSince: T('18:58') }));
    });
  }

  it('A-5: a cannot_be_made 409 carries item_name AND the cannot_be_made object', () => {
    const r = readRefusal(
      conflict('cannot_be_made', 'held', { item_name: 'Rolex', cannot_be_made: { reason: 'item_sold_out', item_name: 'Rolex' } }),
      'o-1',
    );
    expect(r.itemName).toBe('Rolex');
    expect(r.cannotBeMade).toEqual({ reason: 'item_sold_out', itemName: 'Rolex' });
  });

  it('a crossed command reads data.round in a state that has left the floor', () => {
    for (const state of ['declined', 'cancelled', 'served', 'draft', 'released']) {
      const r = readRefusal(conflict('round_not_held', state), 'o-1');
      expect(r.round?.state).withContext(state).toBe(state as never);
    }
  });

  it('a data.round about ANOTHER order, or an unreadable one, is not taken — the reason still stands', () => {
    const other = { ...conflict('round_released', 'released'), data: { round: commandRound('released', { order_id: 'o-2' }) } };
    expect(readRefusal(other, 'o-1')).toEqual(jasmine.objectContaining({ reason: 'round_released', round: null }));
    const broken = { ...conflict('round_released', 'released'), data: { round: { order_id: 'o-1' } } };
    expect(readRefusal(broken, 'o-1')).toEqual(jasmine.objectContaining({ reason: 'round_released', round: null }));
    const none = { status: 409, message: 'm', reason: 'round_released', state: 'released' };
    expect(readRefusal(none, 'o-1').round).toBeNull();
  });

  it('reads an unrecognised reason as unknown, never as one of the eight', () => {
    expect(readRefusal({ status: 409, reason: 'table_on_fire', state: 'held' }, 'o-1').reason).toBe('unknown');
    expect(readRefusal('not a body', 'o-1').reason).toBe('unknown');
  });
});

describe('floor-adapter — the status verb answer', () => {
  it('reads the table the verb answered with, at the status asked for', () => {
    expect(readStatusOk({ status: 200, message: 'ok', data: { id: 't-1', status: 'dirty' } }, 't-1', 'dirty').kind).toBe('ok');
  });

  it('refuses an answer about another table or another status', () => {
    expect(readStatusOk({ status: 200, message: 'ok', data: { id: 't-2', status: 'dirty' } }, 't-1', 'dirty').kind).toBe('invalid');
    expect(readStatusOk({ status: 200, message: 'ok', data: { id: 't-1', status: 'available' } }, 't-1', 'dirty').kind).toBe('invalid');
    expect(readStatusOk({ status: 200, message: 'ok' }, 't-1', 'dirty').kind).toBe('invalid');
  });
});
