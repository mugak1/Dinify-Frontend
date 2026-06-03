/**
 * KitchenOrderService — the swappable seam between the board UI and its data.
 *
 * Phase 3: HTTP polling + PATCH calls run behind the SAME interface the mock used,
 * so the UI is untouched. The board owns the poll lifecycle (startPolling on init,
 * stopPolling on destroy); ticket state lives here in signals — components never
 * own it. The mock dataset + dev controls remain behind USE_MOCK_DATA as dormant
 * design-review aids (flip the const to true to use them locally).
 */

import { Injectable, computed, signal } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { delay, map, tap, timeout } from 'rxjs/operators';

import { ApiResponse } from '../../_models/app.models';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
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

/** Flip to true to serve the in-memory MOCK dataset for local design review. */
const USE_MOCK_DATA = false;

/** Healthy poll cadence. Failures back off 3 → 5 → 10s; recovery snaps back. */
const POLL_BASE_MS = 3000;
/** A poll that doesn't answer within this window counts as a failure (covers
 *  silent hangs so connection health can't get stuck on 'connected'). */
const POLL_TIMEOUT_MS = 8000;

/**
 * Pull the ticket array out of the API envelope. Active-orders may come back as
 * a bare array or wrapped as `{ data: { records: [...] } }` — handle both.
 */
function extractTickets(res: ApiResponse<KitchenTicket>): KitchenTicket[] {
  const d: any = res?.data;
  if (Array.isArray(d)) return d as KitchenTicket[];
  if (Array.isArray(d?.records)) return d.records as KitchenTicket[];
  return [];
}

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

  /** Always-visible link health, derived from poll outcomes (NOT navigator.onLine). */
  readonly connectionState = signal<ConnectionState>('connected');

  // ── Poll loop state (service-owned) ───────────────────────────────────
  private pollActive = false;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Subscription | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthenticationService,
  ) {}

  /** The tablet's restaurant — the active-orders query is scoped to it. First
   *  membership for now if a user belongs to several. */
  private get restaurantId(): string | undefined {
    return this.auth.userValue?.profile?.restaurant_roles?.[0]?.restaurant_id;
  }

  /**
   * Fetch the active ticket set once and write it into the store. THE SEAM —
   * the poll loop calls this on a schedule; tests call it directly.
   */
  loadActive(): Observable<KitchenTicket[]> {
    if (USE_MOCK_DATA) {
      return of(getMockTickets()).pipe(
        delay(400),
        tap(tickets => this._tickets.set(tickets)),
      );
    }
    // The backend 400s without a restaurant scope; omit the param entirely when
    // absent so it never serialises as the literal string "undefined".
    const params = this.restaurantId ? { restaurant: this.restaurantId } : {};
    return this.api.get<KitchenTicket>(null, 'kitchen/orders/active/', params).pipe(
      map(extractTickets),
      tap(tickets => this._tickets.set(tickets)),
    );
  }

  // ── Poll lifecycle (board drives start/stop) ──────────────────────────

  /** Begin polling. Idempotent. */
  startPolling(): void {
    if (this.pollActive) return;
    this.pollActive = true;
    if (USE_MOCK_DATA) {
      // Mock: one-shot load so injected/mutated tickets aren't clobbered by a loop.
      this.inFlight = this.loadActive().subscribe();
      return;
    }
    this.pollOnce();
  }

  /** Stop polling and cancel any in-flight request / pending timer. */
  stopPolling(): void {
    this.pollActive = false;
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    this.inFlight?.unsubscribe();
    this.inFlight = null;
  }

  private pollOnce(): void {
    if (!this.pollActive) return;
    this.inFlight = this.loadActive()
      .pipe(timeout(POLL_TIMEOUT_MS))
      .subscribe({
        next: () => {
          this.consecutiveFailures = 0;
          this.connectionState.set('connected');
          this.inFlight = null;
          this.scheduleNext();
        },
        error: () => {
          this.consecutiveFailures++;
          // One missed window → reconnecting; ~3 in a row → offline.
          this.connectionState.set(this.consecutiveFailures >= 3 ? 'offline' : 'reconnecting');
          this.inFlight = null;
          this.scheduleNext();
        },
      });
  }

  private scheduleNext(): void {
    if (!this.pollActive) return;
    this.pollHandle = setTimeout(() => this.pollOnce(), this.nextDelayMs());
  }

  private nextDelayMs(): number {
    switch (this.consecutiveFailures) {
      case 0: return POLL_BASE_MS; // healthy / just recovered
      case 1: return 5000;
      default: return 10000; // 2+ consecutive failures
    }
  }

  // ── Mutations (optimistic update → real PATCH → revert on failure) ─────

  /**
   * Advance one step along new → preparing → ready → served. Illegal jumps are
   * rejected (returns false, no state change). Stamps served_at on → served.
   * Optimistic locally; the next poll reconciles, and a failed PATCH reverts.
   */
  advanceStatus(id: string, next: FulfilmentStatus): boolean {
    const ticket = this._tickets().find(t => t.id === id);
    if (!ticket || !isLegalAdvance(ticket.fulfilment_status, next)) return false;
    this.patchTicket(id, {
      fulfilment_status: next,
      served_at: next === 'served' ? new Date().toISOString() : ticket.served_at,
    });
    this.persistFulfilmentStatus(id, next, ticket);
    return true;
  }

  /**
   * Step a ticket back: served → ready (within the recall window only) or
   * ready → preparing (any time). Rejected (returns false) when ineligible.
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
    this.persistFulfilmentStatus(id, target, ticket);
    return true;
  }

  /** Flip the priority flag (optimistic + PATCH + revert on failure). */
  togglePriority(id: string): void {
    const ticket = this._tickets().find(t => t.id === id);
    if (!ticket) return;
    const next = !ticket.priority;
    this.patchTicket(id, { priority: next });
    if (!USE_MOCK_DATA) {
      this.api
        .postPatch(`kitchen/orders/${id}/priority/`, { priority: next }, 'put')
        .subscribe({ error: () => this.revertTicket(ticket) });
    }
  }

  /**
   * Drop served tickets that have aged past the recall window. The board no
   * longer calls this in Phase 3 (the server's active-set query owns pruning),
   * but it's kept as a pure helper for the dormant mock path and its unit test.
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
   * chime + entry animation — the same path real poll results surface through.
   * Mock-only.
   */
  injectNewTicket(): KitchenTicket {
    const ticket = buildInjectedTicket();
    this._tickets.update(tickets => [...tickets, ticket]);
    return ticket;
  }

  // ── internal ──────────────────────────────────────────────────────────

  /** Fire the real fulfilment-status PATCH (shared by advance + recall). The
   *  endpoint derives the restaurant from the order pk, so no scope param. */
  private persistFulfilmentStatus(
    id: string,
    status: FulfilmentStatus,
    prior: KitchenTicket,
  ): void {
    if (USE_MOCK_DATA) return;
    this.api
      .postPatch(`kitchen/orders/${id}/fulfilment-status/`, { fulfilment_status: status }, 'put')
      .subscribe({ error: () => this.revertTicket(prior) });
  }

  /** Restore a ticket to its pre-mutation snapshot after a failed PATCH. */
  private revertTicket(prior: KitchenTicket): void {
    this._tickets.update(tickets =>
      tickets.map(t => (t.id === prior.id ? prior : t)),
    );
  }

  private patchTicket(id: string, changes: Partial<KitchenTicket>): void {
    this._tickets.update(tickets =>
      tickets.map(t => (t.id === id ? { ...t, ...changes } : t)),
    );
  }
}
