import {
  CHIP_CLASSES,
  DECLINE_CONFIRM_BODY,
  DECLINE_CONFIRM_TITLE,
  FULFILMENT_LABEL,
  HELD_LABEL,
  PAYMENT_UNKNOWN_LABEL,
  STALE_LABEL,
  STATUS_ACTIONS,
  ORDER_GONE_MESSAGE,
  TABLE_STATUS_LABEL,
  TABLE_TONE_CLASSES,
  UNKNOWN_STATUS_LABEL,
  commandDoneMessage,
  moneyLabel,
  needsStaffFirst,
  refusalMessage,
  roundStateLabel,
  tableStatusLabel,
  tableTone,
  unknownAnswerMessage,
} from './floor-presentation';
import { FloorTable, ROUND_REFUSAL_REASONS } from '../models/floor.models';
import { PAYMENT_CLAIM, RED_CLASS } from './floor-claims.testing';


describe('floor-presentation — status tints are never red', () => {
  for (const [tone, classes] of Object.entries(TABLE_TONE_CLASSES)) {
    it(`table tone "${tone}" uses no red (${classes})`, () => {
      expect(RED_CLASS.test(classes)).withContext(classes).toBeFalse();
    });
  }
  for (const [tone, classes] of Object.entries(CHIP_CLASSES)) {
    it(`chip tone "${tone}" uses no red (${classes})`, () => {
      expect(RED_CLASS.test(classes)).withContext(classes).toBeFalse();
    });
  }

  it('the matcher itself fires on every red it guards against', () => {
    for (const red of ['bg-primary/10', 'text-primary', 'border-d-red', 'bg-destructive/20', 'text-red-600', 'hover:bg-rose-100']) {
      expect(RED_CLASS.test(red)).withContext(red).toBeTrue();
    }
    for (const fine of ['text-primary-foreground', 'bg-amber-100', 'border-green-300', 'bg-selected']) {
      expect(RED_CLASS.test(fine)).withContext(fine).toBeFalse();
    }
  });

  it('amber waits (stronger when stale), green is released, grey is neutral', () => {
    const t = (over: Partial<FloorTable>): FloorTable => ({
      id: 't', number: 1, displayName: 'T1', areaId: null, status: 'seated', occupied: false,
      needsStaff: false, visit: null, rounds: [], ...over,
    });
    const held = { orderId: 'o', roundNumber: 1, state: 'held' as const, source: 'diner' as const, acceptedAt: 'x', acceptedAtProvenance: null, heldSince: 'x', releasedAt: null, stale: false, fulfilmentStatus: 'new' as const, itemCount: 1, value: '1.00' };
    expect(tableTone(t({ needsStaff: true, occupied: true, rounds: [held] }))).toBe('waiting');
    expect(tableTone(t({ needsStaff: true, occupied: true, rounds: [{ ...held, stale: true }] }))).toBe('stale');
    expect(tableTone(t({ occupied: true, rounds: [{ ...held, state: 'released', heldSince: null, releasedAt: 'x' }] }))).toBe('released');
    expect(tableTone(t({ status: 'available' }))).toBe('neutral');
    expect(tableTone(t({ status: 'dirty' }))).toBe('dirty');
    expect(tableTone(t({ status: 'out_of_service' }))).toBe('off');
  });
});

describe('floor-presentation — copy', () => {
  it('a held round reads "Waiting for staff", and "Waiting over 15 min" when the server says stale', () => {
    expect(HELD_LABEL).toBe('Waiting for staff');
    expect(STALE_LABEL).toBe('Waiting over 15 min');
    expect(roundStateLabel({ state: 'held', stale: false })).toBe('Waiting for staff');
    expect(roundStateLabel({ state: 'held', stale: true })).toBe('Waiting over 15 min');
  });

  it('the decline confirmation says exactly what declining does', () => {
    expect(`${DECLINE_CONFIRM_TITLE} ${DECLINE_CONFIRM_BODY}`).toBe(
      'Decline this order? It will not be sent to the kitchen.',
    );
  });

  it('the three status actions are Mark dirty, Mark available and Out of service', () => {
    expect(STATUS_ACTIONS.map(a => a.label)).toEqual(['Mark dirty', 'Mark available', 'Out of service']);
  });

  for (const command of ['confirm', 'decline'] as const) {
    for (const reason of ROUND_REFUSAL_REASONS) {
      it(`has readable copy for a ${command} refused with ${reason}`, () => {
        const text = refusalMessage(command, reason, 'Rolex');
        expect(text.length).toBeGreaterThan(20);
        expect(text).not.toContain(reason); // never the machine code
        expect(text).not.toMatch(/refused|409|error/i);
      });
    }
  }

  it('every reason reads differently from the fallback', () => {
    const fallback = refusalMessage('confirm', 'unknown', null);
    for (const reason of ROUND_REFUSAL_REASONS) {
      expect(refusalMessage('confirm', reason, 'Rolex')).not.toBe(fallback);
    }
  });

  it('DECISION 2: a stored status outside the five reads "Status unknown"; the five read as before', () => {
    for (const s of ['reserved', '', 'AVAILABLE', 'closed']) expect(tableStatusLabel(s)).withContext(s).toBe('Status unknown');
    for (const [s, label] of Object.entries(TABLE_STATUS_LABEL)) expect(tableStatusLabel(s)).toBe(label);
  });

  it('an unknown status is a neutral tone, never red', () => {
    const t = {
      id: 't', number: 1, displayName: 'T1', areaId: null, status: 'reserved', occupied: false,
      needsStaff: false, visit: null, rounds: [],
    } as FloorTable;
    expect(tableTone(t)).toBe('neutral');
  });

  it('C-1: table_out_of_service no longer says only diner orders are blocked', () => {
    const text = refusalMessage('confirm', 'table_out_of_service', null);
    expect(text).not.toContain('diner');
    expect(text).toContain('out of service');
  });

  it('a 404 reads exactly "This order is no longer available."', () => {
    expect(ORDER_GONE_MESSAGE).toBe('This order is no longer available.');
  });

  it('"Cannot be made" names the item', () => {
    expect(refusalMessage('confirm', 'cannot_be_made', 'Rolex')).toContain('Cannot be made — Rolex');
  });

  it('NO PAYMENT CLAIM in any label, copy, toast or confirmation the view can show', () => {
    const everything = [
      ...Object.values(TABLE_STATUS_LABEL),
      UNKNOWN_STATUS_LABEL,
      ORDER_GONE_MESSAGE,
      ...Object.values(FULFILMENT_LABEL),
      ...STATUS_ACTIONS.flatMap(a => [a.label, a.done]),
      HELD_LABEL, STALE_LABEL, PAYMENT_UNKNOWN_LABEL, DECLINE_CONFIRM_TITLE, DECLINE_CONFIRM_BODY,
      ...(['confirm', 'decline'] as const).flatMap(c => [
        ...ROUND_REFUSAL_REASONS.map(r => refusalMessage(c, r, 'Rolex')),
        refusalMessage(c, 'unknown', null),
        unknownAnswerMessage(c),
        commandDoneMessage(c, 1, true),
        commandDoneMessage(c, 1, false),
      ]),
    ];
    for (const text of everything) expect(PAYMENT_CLAIM.test(text)).withContext(text).toBeFalse();
    expect(PAYMENT_UNKNOWN_LABEL).toBe('Payment unknown');
  });

  it('the payment matcher fires on the claims it guards against', () => {
    for (const claim of ['marked as paid and cleared', 'Off-system payment recorded (cash)', 'Unpaid', 'Paid', 'Payment received']) {
      expect(PAYMENT_CLAIM.test(claim)).withContext(claim).toBeTrue();
    }
    for (const fine of ['Payment unknown', 'UGX 17,000 to pay', 'Bill requested']) {
      expect(PAYMENT_CLAIM.test(fine)).withContext(fine).toBeFalse();
    }
  });
});

describe('floor-presentation — order and money', () => {
  it('tables needing staff come first, the server order kept inside each group', () => {
    const t = (number: number, needsStaff: boolean) => ({ number, needsStaff });
    const ordered = needsStaffFirst([t(1, false), t(9, true), t(3, false), t(2, true), t(4, false)]);
    expect(ordered.map(x => x.number)).toEqual([9, 2, 1, 3, 4]);
  });

  it('money is read from the decimal string, never through a float', () => {
    expect(moneyLabel('17000.00')).toBe('UGX 17,000');
    expect(moneyLabel('1.10')).toBe('UGX 1.10');
    expect(moneyLabel('1234567.35')).toBe('UGX 1,234,567.35');
    expect(moneyLabel('not money')).toBe('—');
  });
});
