/**
 * Words and tints for the floor view (Step 2). One place, so the canvas, the drawer
 * and the specs cannot disagree.
 *
 * COLOUR ROLES (CLAUDE.md → Styling Rules). Brand red is the one primary action
 * (Confirm) and nothing else. A STATUS IS NEVER RED — not brand red and not
 * destructive: amber is waiting (stronger when stale), green is released, grey is
 * neutral. The destructive tone is kept for a real problem — "Cannot be made" — and for
 * Decline, which is an action, not a status. `floor-presentation.spec.ts` pins it.
 *
 * NO PAYMENT CLAIM. Step 2 records no payment. Nothing here says paid, unpaid or
 * settled; the bill reads "Payment unknown", and a held round's value is "to pay",
 * not owed.
 */
import { formatAmount } from '../../../_shared/utils/decimal-money';
import {
  FloorRound,
  FloorStatusAction,
  FloorTable,
  FloorTableStatus,
  FulfilmentStatus,
  RoundCommand,
  RoundRefusalReason,
  isKnownTableStatus,
} from '../models/floor.models';

export const TABLE_STATUS_LABEL: Record<FloorTableStatus, string> = {
  available: 'Available',
  seated: 'Seated',
  bill_requested: 'Bill requested',
  dirty: 'Dirty',
  out_of_service: 'Out of service',
};

/**
 * What a table's status reads as. A stored value outside the five (decision 2, FE-C)
 * reads "Status unknown": it is neutral grey like every status, its value is kept on
 * the model rather than guessed, and the drawer's three status actions stay enabled,
 * because they are how staff put the table right.
 */
export const UNKNOWN_STATUS_LABEL = 'Status unknown';

export function tableStatusLabel(status: string): string {
  return isKnownTableStatus(status) ? TABLE_STATUS_LABEL[status] : UNKNOWN_STATUS_LABEL;
}

export const STATUS_FILTER_OPTIONS: { value: FloorTableStatus; label: string }[] = (
  Object.keys(TABLE_STATUS_LABEL) as FloorTableStatus[]
).map(value => ({ value, label: TABLE_STATUS_LABEL[value] }));

export const FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  new: 'Not started',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
};

/** The three status actions, in the order the drawer shows them. */
export const STATUS_ACTIONS: { status: FloorStatusAction; label: string; done: string }[] = [
  { status: 'dirty', label: 'Mark dirty', done: 'marked dirty' },
  { status: 'available', label: 'Mark available', done: 'marked available' },
  { status: 'out_of_service', label: 'Out of service', done: 'marked out of service' },
];

export const HELD_LABEL = 'Waiting for staff';
export const STALE_LABEL = 'Waiting over 15 min';
export const RELEASED_LABEL = 'Sent to kitchen';
export const PAYMENT_UNKNOWN_LABEL = 'Payment unknown';
export const DECLINE_CONFIRM_TITLE = 'Decline this order?';
export const DECLINE_CONFIRM_BODY = 'It will not be sent to the kitchen.';

/** What a held round reads: the stale flag is the server's, never recomputed here. */
export function roundStateLabel(round: Pick<FloorRound, 'state' | 'stale'>): string {
  if (round.state === 'held') return round.stale ? STALE_LABEL : HELD_LABEL;
  return RELEASED_LABEL;
}

// ── Tints ─────────────────────────────────────────────────────────

/** How a table reads at a glance. */
export type TableTone = 'stale' | 'waiting' | 'released' | 'neutral' | 'dirty' | 'off';

export function tableTone(t: FloorTable): TableTone {
  const held = t.rounds.filter(r => r.state === 'held');
  if (t.needsStaff || held.length > 0) return held.some(r => r.stale) ? 'stale' : 'waiting';
  if (t.status === 'out_of_service') return 'off';
  if (t.occupied) return 'released';
  if (t.status === 'dirty') return 'dirty';
  return 'neutral';
}

/** Card surfaces. Amber = waiting (stronger when stale), green = released, grey = neutral. */
export const TABLE_TONE_CLASSES: Record<TableTone, string> = {
  stale: 'bg-amber-100 border-amber-500',
  waiting: 'bg-amber-50 border-amber-300',
  released: 'bg-green-50 border-green-300',
  neutral: 'bg-card border-border',
  dirty: 'bg-muted border-border',
  off: 'bg-muted border-dashed border-border opacity-70',
};

/** Small status chips (round state, table status). Same roles as the cards. */
export const CHIP_CLASSES = {
  stale: 'bg-amber-200 text-amber-950',
  waiting: 'bg-amber-100 text-amber-900',
  released: 'bg-green-100 text-green-800',
  neutral: 'bg-secondary text-secondary-foreground',
} as const;

export type ChipTone = keyof typeof CHIP_CLASSES;

export function roundChipTone(round: Pick<FloorRound, 'state' | 'stale'>): ChipTone {
  if (round.state === 'held') return round.stale ? 'stale' : 'waiting';
  return 'released';
}

// ── Order ─────────────────────────────────────────────────────────

/**
 * Tables that need staff first. The server already orders the floor this way; this
 * is a STABLE partition that keeps the server's order inside each group, so it agrees
 * with a correct server and still lists waiting tables first if one is not.
 */
export function needsStaffFirst<T extends Pick<FloorTable, 'needsStaff'>>(tables: readonly T[]): T[] {
  return [...tables.filter(t => t.needsStaff), ...tables.filter(t => !t.needsStaff)];
}

// ── Time and money ────────────────────────────────────────────────

/** Whole minutes from an ISO instant to `nowMs` (the SERVER's clock), never negative. */
export function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - then) / 60_000));
}

export function ageLabel(minutes: number | null): string {
  if (minutes === null) return '';
  return minutes < 1 ? 'under 1 min' : `${minutes} min`;
}

/** Clock time in the restaurant's zone (EAT, the offset every floor timestamp carries). */
export function clockLabel(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Kampala',
  });
}

/**
 * The server's decimal string, exactly: digits are read, never passed through a
 * float. Whole shillings drop the `.00`; a real fraction is kept.
 */
export function moneyLabel(value: string): string {
  const exact = formatAmount(value);
  return exact === null ? '—' : `UGX ${exact.replace(/\.00$/, '')}`;
}

// ── Refusals ──────────────────────────────────────────────────────

/**
 * Readable copy for every 409 reason in contract v1, per command. `itemName` is the
 * item a `cannot_be_made` refusal names.
 */
export function refusalMessage(
  command: RoundCommand,
  reason: RoundRefusalReason | 'unknown',
  itemName: string | null,
): string {
  switch (reason) {
    case 'round_declined':
      return command === 'confirm'
        ? 'This order was already declined, so it can’t be sent to the kitchen.'
        : 'This order was already declined.';
    case 'round_released':
      return command === 'decline'
        ? 'This order has already been sent to the kitchen, so it can’t be declined.'
        : 'This order has already been sent to the kitchen.';
    case 'round_not_held':
      return 'This order is no longer waiting for staff. The floor has been refreshed.';
    case 'restaurant_not_trading':
      return command === 'confirm'
        ? 'Your restaurant isn’t taking diner orders yet, so this order can’t be sent to the kitchen.'
        : 'Your restaurant isn’t open for orders, so this order can’t be changed right now.';
    case 'ordering_paused':
      return 'Ordering is paused, so diner orders can’t be sent to the kitchen. Resume ordering in Settings › Availability first.';
    case 'table_menu_only':
      return 'This table’s QR code is set to menu only, so diner orders from it can’t be sent to the kitchen.';
    case 'table_out_of_service':
      // C-1: table liveness binds staff rounds as well as diner rounds.
      return 'This table is out of service, so orders from it can’t be sent to the kitchen. Mark it available first.';
    case 'cannot_be_made':
      return itemName
        ? `Cannot be made — ${itemName}. Decline the order, or put the item back in stock first.`
        : 'Something in this order can’t be made. Decline the order, or put the item back in stock first.';
    default:
      return 'This order changed while you were looking at it. The floor has been refreshed.';
  }
}

/**
 * A command answered 404 (D-16, C-2): the order does not exist for this user any more
 * — it was removed, the restaurant was suspended, or the user lost the `tables`
 * module. One sentence for all of them, as the server gives one answer for all of them.
 */
export const ORDER_GONE_MESSAGE = 'This order is no longer available.';

/** No readable answer: the server may have acted, and resending is safe. */
export function unknownAnswerMessage(command: RoundCommand): string {
  return command === 'confirm'
    ? 'We couldn’t get an answer about this order. It’s safe to try Confirm again.'
    : 'We couldn’t get an answer about this order. It’s safe to try Decline again.';
}

/** The success toast. `changed: false` is a resend the server had already applied. */
export function commandDoneMessage(command: RoundCommand, roundNumber: number, changed: boolean): string {
  if (command === 'confirm') {
    return changed ? `Round ${roundNumber} sent to the kitchen` : `Round ${roundNumber} was already sent to the kitchen`;
  }
  return changed ? `Round ${roundNumber} declined. It won’t be sent to the kitchen` : `Round ${roundNumber} was already declined`;
}
