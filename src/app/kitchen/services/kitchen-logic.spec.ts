import { KitchenTicket } from '../models/kitchen.models';
import {
  OVERDUE_MS,
  RECALL_WINDOW_MS,
  WARNING_MS,
  classifyEscalation,
  classifyModifier,
  formatAge,
  formatOrderNumber,
  isLegalAdvance,
  isRecallEligible,
  isWithinRecallWindow,
  nextStatus,
  recallTarget,
  sortTickets,
} from './kitchen-logic';

const NOW = 1_700_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function ticket(partial: Partial<KitchenTicket>): KitchenTicket {
  return {
    id: 'x',
    order_number: 1,
    table_label: 'Table 1',
    order_source: 'diner_self_service',
    fulfilment_status: 'new',
    priority: false,
    created_at: iso(0),
    served_at: null,
    items: [],
    ...partial,
  };
}

describe('classifyEscalation', () => {
  it('is normal just below the warning threshold', () => {
    expect(classifyEscalation(iso(WARNING_MS - 1000), null, NOW)).toBe('normal');
  });

  it('is warning exactly at the warning threshold', () => {
    expect(classifyEscalation(iso(WARNING_MS), null, NOW)).toBe('warning');
  });

  it('stays warning just below the overdue threshold', () => {
    expect(classifyEscalation(iso(OVERDUE_MS - 1000), null, NOW)).toBe('warning');
  });

  it('is overdue exactly at the overdue threshold', () => {
    expect(classifyEscalation(iso(OVERDUE_MS), null, NOW)).toBe('overdue');
  });

  it('is always normal once served, regardless of age', () => {
    expect(classifyEscalation(iso(OVERDUE_MS * 2), iso(1000), NOW)).toBe('normal');
  });
});

describe('classifyModifier', () => {
  it('flags removals/holds/substitutions as omissions', () => {
    expect(classifyModifier('no pickles')).toBe('omission');
    expect(classifyModifier('Without onions')).toBe('omission');
    expect(classifyModifier('hold the mayo')).toBe('omission');
    expect(classifyModifier('no')).toBe('omission');
  });

  it('flags add-ons as additions', () => {
    expect(classifyModifier('extra cheese')).toBe('addition');
    expect(classifyModifier('add bacon')).toBe('addition');
  });

  it('flags doneness terms as prep (exact match, case-insensitive)', () => {
    expect(classifyModifier('well done')).toBe('prep');
    expect(classifyModifier('Medium Rare')).toBe('prep');
    expect(classifyModifier('medium')).toBe('prep');
  });

  it("falls back to 'neutral' for unrecognised phrasing (the safe default)", () => {
    expect(classifyModifier('on a separate plate')).toBe('neutral');
    expect(classifyModifier('leave off onions')).toBe('neutral');
  });

  it('never classifies a string as both omission and addition', () => {
    const omissions = ['no pickles', 'Without onions', 'hold the mayo', 'w/o ice', '86 olives', 'sub fries'];
    const additions = ['extra cheese', 'add bacon', 'with ranch', 'double patty', 'side salad'];
    omissions.forEach((s) => expect(classifyModifier(s)).toBe('omission'));
    additions.forEach((s) => expect(classifyModifier(s)).toBe('addition'));
  });
});

describe('status transitions', () => {
  it('advances exactly one step forward', () => {
    expect(nextStatus('new')).toBe('preparing');
    expect(nextStatus('preparing')).toBe('ready');
    expect(nextStatus('ready')).toBe('served');
    expect(nextStatus('served')).toBeNull();
  });

  it('accepts legal advances and rejects skips/back-steps', () => {
    expect(isLegalAdvance('new', 'preparing')).toBe(true);
    expect(isLegalAdvance('new', 'ready')).toBe(false);
    expect(isLegalAdvance('ready', 'preparing')).toBe(false);
    expect(isLegalAdvance('served', 'ready')).toBe(false);
  });

  it('maps recall targets', () => {
    expect(recallTarget('served')).toBe('ready');
    expect(recallTarget('ready')).toBe('preparing');
    expect(recallTarget('preparing')).toBeNull();
    expect(recallTarget('new')).toBeNull();
  });
});

describe('isRecallEligible', () => {
  it('allows served → ready within the 10-min window', () => {
    expect(isRecallEligible(ticket({ fulfilment_status: 'served', served_at: iso(RECALL_WINDOW_MS - 1000) }), NOW)).toBe(true);
  });

  it('rejects served → ready beyond the window', () => {
    expect(isRecallEligible(ticket({ fulfilment_status: 'served', served_at: iso(RECALL_WINDOW_MS + 1000) }), NOW)).toBe(false);
  });

  it('allows ready → preparing at any time (no window)', () => {
    expect(isRecallEligible(ticket({ fulfilment_status: 'ready' }), NOW)).toBe(true);
  });

  it('rejects new and preparing', () => {
    expect(isRecallEligible(ticket({ fulfilment_status: 'new' }), NOW)).toBe(false);
    expect(isRecallEligible(ticket({ fulfilment_status: 'preparing' }), NOW)).toBe(false);
  });
});

describe('isWithinRecallWindow (board visibility)', () => {
  it('keeps non-served tickets', () => {
    expect(isWithinRecallWindow(ticket({ fulfilment_status: 'preparing' }), NOW)).toBe(true);
  });
  it('keeps served tickets inside the window and drops them outside', () => {
    expect(isWithinRecallWindow(ticket({ fulfilment_status: 'served', served_at: iso(RECALL_WINDOW_MS - 1) }), NOW)).toBe(true);
    expect(isWithinRecallWindow(ticket({ fulfilment_status: 'served', served_at: iso(RECALL_WINDOW_MS + 1) }), NOW)).toBe(false);
  });
});

describe('sortTickets', () => {
  it('orders priority first, then oldest first within each band', () => {
    const tickets = [
      ticket({ id: 'a', priority: false, created_at: iso(1000) }),
      ticket({ id: 'b', priority: true, created_at: iso(2000) }),
      ticket({ id: 'c', priority: false, created_at: iso(5000) }), // oldest non-priority
      ticket({ id: 'd', priority: true, created_at: iso(9000) }),  // oldest priority
    ];
    expect(sortTickets(tickets, NOW).map(t => t.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('formatOrderNumber', () => {
  it('zero-pads to three digits', () => {
    expect(formatOrderNumber(7)).toBe('#007');
    expect(formatOrderNumber(42)).toBe('#042');
    expect(formatOrderNumber(142)).toBe('#142');
  });
  it('does not truncate four-digit numbers', () => {
    expect(formatOrderNumber(1000)).toBe('#1000');
  });
});

describe('formatAge', () => {
  it('formats minutes and seconds', () => {
    expect(formatAge(iso(0), NOW)).toBe('0:00');
    expect(formatAge(iso(65_000), NOW)).toBe('1:05');
  });
  it('adds hours past 60 minutes', () => {
    expect(formatAge(iso(3_661_000), NOW)).toBe('1:01:01');
  });
});
