/**
 * Kitchen View — pure, framework-free logic.
 *
 * Everything here is a pure function of its inputs (no signals, no DI, no
 * Date.now() reads inside) so it is trivially unit-testable at the documented
 * boundaries. The service and components consume these; they own all state.
 */

import {
  EscalationLevel,
  FulfilmentStatus,
  KitchenTicket,
} from '../models/kitchen.models';

// ── Configurable thresholds (confirmed Phase 1 defaults) ────────────────
/** Age at which a not-yet-served ticket turns yellow/warning. */
export const WARNING_MS = 8 * 60_000;
/** Age at which a not-yet-served ticket turns red/overdue. */
export const OVERDUE_MS = 15 * 60_000;
/** How long a served ticket stays recallable (and visible on the board). */
export const RECALL_WINDOW_MS = 10 * 60_000;

/** Forward order of the fulfilment lifecycle. */
export const STATUS_ORDER: readonly FulfilmentStatus[] = [
  'new',
  'preparing',
  'ready',
  'served',
];

/**
 * Age-based escalation. A served ticket is always calm — escalation tracks
 * how long a ticket has been WAITING, which stops the moment it's served.
 */
export function classifyEscalation(
  created_at: string,
  served_at: string | null,
  now: number,
): EscalationLevel {
  if (served_at) return 'normal';
  const age = now - new Date(created_at).getTime();
  if (age >= OVERDUE_MS) return 'overdue';
  if (age >= WARNING_MS) return 'warning';
  return 'normal';
}

/** The next status forward, or null if already served (terminal). */
export function nextStatus(s: FulfilmentStatus): FulfilmentStatus | null {
  const i = STATUS_ORDER.indexOf(s);
  return i >= 0 && i < STATUS_ORDER.length - 1 ? STATUS_ORDER[i + 1] : null;
}

/** A legal advance is exactly one step forward along STATUS_ORDER. */
export function isLegalAdvance(from: FulfilmentStatus, to: FulfilmentStatus): boolean {
  return nextStatus(from) === to;
}

/** The status a recall steps back to, or null if recall makes no sense. */
export function recallTarget(s: FulfilmentStatus): FulfilmentStatus | null {
  if (s === 'served') return 'ready';
  if (s === 'ready') return 'preparing';
  return null;
}

/**
 * Recall eligibility — branches on status, NOT one blanket window check:
 *  - served → ready: only within the 10-min window of served_at.
 *  - ready  → preparing: whenever ready (active correction; served_at is null,
 *    so the window does not apply).
 */
export function isRecallEligible(ticket: KitchenTicket, now: number): boolean {
  switch (ticket.fulfilment_status) {
    case 'served':
      if (!ticket.served_at) return false;
      return now - new Date(ticket.served_at).getTime() <= RECALL_WINDOW_MS;
    case 'ready':
      return true;
    default:
      return false;
  }
}

/**
 * A served ticket should drop off the board once past the recall window.
 * Returns true when the ticket should still be shown.
 */
export function isWithinRecallWindow(ticket: KitchenTicket, now: number): boolean {
  if (ticket.fulfilment_status !== 'served') return true;
  if (!ticket.served_at) return true;
  return now - new Date(ticket.served_at).getTime() <= RECALL_WINDOW_MS;
}

/**
 * Board sort order: priority tickets first, then oldest created_at first
 * (FIFO within each priority band).
 */
export function sortTickets(
  tickets: readonly KitchenTicket[],
  _now: number,
): KitchenTicket[] {
  return [...tickets].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/** Order-number display: "#" + zero-padded to 3 digits (e.g. #007, #142). */
export function formatOrderNumber(n: number): string {
  return '#' + String(n).padStart(3, '0');
}

/** Ticket age in ms (never negative). */
export function ageMs(created_at: string, now: number): number {
  return Math.max(0, now - new Date(created_at).getTime());
}

/** Compact age display: "m:ss" under an hour, else "h:mm:ss". */
export function formatAge(created_at: string, now: number): string {
  const totalSec = Math.floor(ageMs(created_at, now) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
