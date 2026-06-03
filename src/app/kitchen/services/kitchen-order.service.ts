/**
 * KitchenOrderService — the swappable seam between the board UI and its data.
 *
 * Phase 1: serves the MOCK dataset in-memory; mutations are optimistic and local.
 * Phase 3: HTTP polling + PATCH calls drop in behind this SAME interface with the
 * UI untouched (see the TODO(Phase 3) blocks). Board state lives here in signals;
 * components never own ticket state.
 */

import { Injectable, computed, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, tap } from 'rxjs/operators';

import {
  ConnectionState,
  FulfilmentStatus,
  KitchenTicket,
} from '../models/kitchen.models';
import {
  isLegalAdvance,
  isRecallEligible,
  isWithinRecallWindow,
  recallTarget,
  sortTickets,
} from './kitchen-logic';
import { buildInjectedTicket, getMockTickets } from '../mock/kitchen-mock-data';

/** Set to false in Phase 3 to use the real polling implementation. */
const USE_MOCK_DATA = true;

@Injectable({ providedIn: 'root' })
export class KitchenOrderService {
  /** Raw ticket store — the single source of truth. */
  private readonly _tickets = signal<KitchenTicket[]>([]);

  /**
   * Board-ordered tickets: priority first, then oldest first. Sorting here is
   * comparator-only (independent of `now`), so the computed does not need a
   * clock dependency — the board passes `now` to cards for age display.
   */
  readonly activeTickets = computed(() => sortTickets(this._tickets(), Date.now()));

  /** Always-visible link health. */
  readonly connectionState = signal<ConnectionState>('connected');

  /**
   * Fetch the active ticket set. THE SEAM.
   *
   * TODO(Phase 3): replace the mock branch with real polling of
   *   GET api/v1/kitchen/orders/active/ every ~3s, adaptive backoff on failure
   *   (3 → 5 → 10s, snap back to 3s on recovery). Derive connectionState from
   *   the age of the last SUCCESSFUL poll — connected (<~6-8s), reconnecting
   *   (one missed window), offline (~3 failures / ~12-15s) — NOT navigator.onLine.
   *   New tickets are detected by the board diffing IDs across emissions, which
   *   already matches how a poll result surfaces new orders.
   */
  loadActive(): Observable<KitchenTicket[]> {
    if (USE_MOCK_DATA) {
      return of(getMockTickets()).pipe(
        delay(400),
        tap(tickets => this._tickets.set(tickets)),
      );
    }
    // TODO(Phase 3): real HTTP poll wired to this.api.get(...) lives here.
    throw new Error('KitchenOrderService: real polling not implemented (Phase 3).');
  }

  // ── Mutations (optimistic, in-memory in Phase 1) ──────────────────────

  /**
   * Advance one step along new → preparing → ready → served. Illegal jumps are
   * rejected (returns false, no state change). Stamps served_at on → served.
   * TODO(Phase 3): also PATCH the order; reconcile on the next poll.
   */
  advanceStatus(id: string, next: FulfilmentStatus): boolean {
    const ticket = this._tickets().find(t => t.id === id);
    if (!ticket || !isLegalAdvance(ticket.fulfilment_status, next)) return false;
    this.patchTicket(id, {
      fulfilment_status: next,
      served_at: next === 'served' ? new Date().toISOString() : ticket.served_at,
    });
    return true;
  }

  /**
   * Step a ticket back: served → ready (within the recall window only) or
   * ready → preparing (any time). Rejected (returns false) when ineligible.
   * TODO(Phase 3): also PATCH the order; reconcile on the next poll.
   */
  recall(id: string): boolean {
    const ticket = this._tickets().find(t => t.id === id);
    if (!ticket || !isRecallEligible(ticket, Date.now())) return false;
    const target = recallTarget(ticket.fulfilment_status);
    if (!target) return false;
    this.patchTicket(id, {
      fulfilment_status: target,
      // Leaving 'served' clears the served stamp so age/escalation resume.
      served_at: target === 'served' ? ticket.served_at : null,
    });
    return true;
  }

  /** Flip the priority flag. TODO(Phase 3): also PATCH the order. */
  togglePriority(id: string): void {
    const ticket = this._tickets().find(t => t.id === id);
    if (!ticket) return;
    this.patchTicket(id, { priority: !ticket.priority });
  }

  /**
   * Drop served tickets that have aged past the recall window. Writes the
   * signal ONLY when something is actually removed, so the board's 1s tick does
   * not needlessly invalidate the activeTickets computed.
   *
   * TODO(Phase 3): the server's active-set query owns recall-window pruning once
   * polling is live; the client simply renders what it's given and this becomes
   * unnecessary.
   */
  pruneServed(now: number): void {
    const current = this._tickets();
    const kept = current.filter(t => isWithinRecallWindow(t, now));
    if (kept.length !== current.length) this._tickets.set(kept);
  }

  // ── Dev controls (MOCK-ONLY — for design review) ──────────────────────

  /** Force a connection state to exercise the indicator. Mock-only. */
  simulateConnectionState(state: ConnectionState): void {
    this.connectionState.set(state);
  }

  /**
   * Append a brand-new ticket. The board detects it as a new ID and fires the
   * chime + entry animation — the exact same path Phase 3 polling will use.
   * Mock-only.
   */
  injectNewTicket(): KitchenTicket {
    const ticket = buildInjectedTicket();
    this._tickets.update(tickets => [...tickets, ticket]);
    return ticket;
  }

  // ── internal ──────────────────────────────────────────────────────────

  private patchTicket(id: string, changes: Partial<KitchenTicket>): void {
    this._tickets.update(tickets =>
      tickets.map(t => (t.id === id ? { ...t, ...changes } : t)),
    );
  }
}
