import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';

import { FulfilmentStatus, KitchenTicket } from '../models/kitchen.models';
import { classifyEscalation } from '../services/kitchen-logic';
import { KitchenOrderService } from '../services/kitchen-order.service';
import { KitchenStockService } from '../services/kitchen-stock.service';
import { TicketCardComponent } from './ticket-card/ticket-card.component';
import { SoldOutPanelComponent } from './sold-out-panel/sold-out-panel.component';
import { CancelDialogComponent } from './cancel-dialog/cancel-dialog.component';

/** Cards per page in the snap grid (4 cols × 2 rows, tablet-landscape). */
const PAGE_SIZE = 8;
/** How long a freshly-arrived card plays its entry animation. */
const ENTER_MS = 700;
/** While viewing Completed, re-pull the completed feed on roughly the poll cadence. */
const COMPLETED_REFRESH_MS = 3000;

@Component({
  selector: 'app-kitchen-board',
  standalone: true,
  imports: [CommonModule, TicketCardComponent, SoldOutPanelComponent, CancelDialogComponent],
  templateUrl: './board.component.html',
  styleUrls: ['./board.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardComponent implements OnInit, OnDestroy {
  @ViewChild('pager') pager?: ElementRef<HTMLElement>;

  /** Shared clock — one ticker drives every card's age (no per-card timers). */
  readonly now = signal(Date.now());

  /** Active | Completed board view. Active is the default; Completed shows served. */
  readonly viewMode = signal<'active' | 'completed'>('active');

  /** Grid source: the served feed in Completed mode, the live board otherwise.
   *  Both flow through the existing pager / narrow-list unchanged. */
  readonly tickets = computed(() =>
    this.viewMode() === 'completed'
      ? this.service.completedTickets()
      : this.service.activeTickets(),
  );

  /** Tickets chunked into fixed-size pages for the snap grid. */
  readonly pages = computed<KitchenTicket[][]>(() => {
    const all = this.tickets();
    const out: KitchenTicket[][] = [];
    for (let i = 0; i < all.length; i += PAGE_SIZE) out.push(all.slice(i, i + PAGE_SIZE));
    return out.length ? out : [[]];
  });

  readonly currentPage = signal(0);

  /** Narrow (phone / tablet-portrait) layout: single-column scroll list, no pager. */
  readonly isNarrow = signal(false);

  /** IDs currently playing the entry animation. */
  readonly enteringIds = signal<Set<string>>(new Set());

  /** Sold-out ("86") slide-over open state — the board owns it. */
  readonly panelOpen = signal(false);

  /** Ticket awaiting cancel confirmation — drives the cancel dialog. */
  readonly cancelTarget = signal<KitchenTicket | null>(null);

  // ── Sound (gated behind a one-time tap; autoplay policy) ──────────────
  readonly soundArmed = signal(false);
  private audioCtx: AudioContext | null = null;

  // ── Screen Wake Lock (progressive enhancement) ────────────────────────
  readonly wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  readonly wakeLockActive = signal(false);
  private wantWakeLock = false;
  private wakeLockSentinel: WakeLockSentinel | null = null;

  private tickHandle?: ReturnType<typeof setInterval>;
  /** Completed-feed refresh interval; runs only while the Completed view is open. */
  private completedHandle?: ReturnType<typeof setInterval>;
  /** Previous ticket-ID set; null until the first load so we never chime on boot. */
  private prevIds: Set<string> | null = null;
  /** Previous fulfilment status per id; rebuilt each emission so the ready cue fires once. */
  private prevStatus = new Map<string, FulfilmentStatus>();
  /** IDs that have already fired the overdue cue; null until the first tick (boot silence). */
  private overdueFired: Set<string> | null = null;
  private readonly onVisibility = () => this.handleVisibility();

  /** Narrow-screen media query + its change handler (mirrors onVisibility). */
  private mql?: MediaQueryList;
  private readonly onNarrowChange = (e: MediaQueryListEvent) => this.isNarrow.set(e.matches);

  constructor(
    public readonly service: KitchenOrderService,
    public readonly stock: KitchenStockService,
  ) {
    // New-ticket detection by diffing IDs across emissions — the same path
    // Phase 3 polling will surface new orders through. Fires chime + entry
    // animation for IDs that are genuinely new AND in 'new' status. Diffing on
    // IDs (not status) means a new→preparing change does not chime.
    effect(() => {
      const list = this.service.activeTickets();
      const ids = new Set(list.map(t => t.id));
      if (this.prevIds !== null) {
        const fresh = list.filter(t => !this.prevIds!.has(t.id) && t.fulfilment_status === 'new');
        if (fresh.length) this.onNewTickets(fresh.map(t => t.id));
        // Order-ready cue: any ticket transitioning INTO 'ready' (fires once across
        // the optimistic local tap and the poll that re-confirms it).
        if (this.soundArmed()) {
          const becameReady = list.some(
            t => t.fulfilment_status === 'ready' && this.prevStatus.get(t.id) !== 'ready',
          );
          if (becameReady) this.chimeReady();
        }
      }
      // Rebuild every emission (outside the sentinel): seeds on first load, auto-drops
      // departed ids, and records 'ready' so optimistic-tap + poll fire exactly once.
      this.prevStatus = new Map(list.map(t => [t.id, t.fulfilment_status]));
      this.prevIds = ids;
    });
  }

  ngOnInit(): void {
    this.service.startPolling();
    // Prime the sold-out count so the header trigger's badge is accurate before
    // the panel is ever opened. The order board is unaffected (orders ≠ menu).
    this.stock.loadItems();
    this.tickHandle = setInterval(() => {
      const t = Date.now();
      this.now.set(t);
      this.detectOverdue(t);
      this.clampCurrentPage();
    }, 1000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    // Narrow-screen fallback: below 768px the board swaps the landscape pager for
    // a single-column scroll list. Seed from the initial match, then track changes.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.mql = window.matchMedia('(max-width: 768px)');
      this.isNarrow.set(this.mql.matches);
      this.mql.addEventListener('change', this.onNarrowChange);
    }
  }

  ngOnDestroy(): void {
    this.service.stopPolling();
    if (this.tickHandle) clearInterval(this.tickHandle);
    this.stopCompletedRefresh();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.mql?.removeEventListener('change', this.onNarrowChange);
    void this.releaseWakeLock();
    void this.audioCtx?.close();
  }

  // ── View toggle (Active | Completed) ──────────────────────────────────
  /**
   * Switch the board view. The active poll keeps running in BOTH modes (so the
   * new-order chime still alerts while you're on Completed). Entering Completed
   * loads the served feed once and starts a board-owned refresh on the poll
   * cadence; leaving clears it. currentPage resets so the pager starts clean.
   */
  setView(mode: 'active' | 'completed'): void {
    if (this.viewMode() === mode) return;
    this.viewMode.set(mode);
    this.currentPage.set(0);
    if (mode === 'completed') {
      this.service.loadCompleted().subscribe();
      this.startCompletedRefresh();
    } else {
      this.stopCompletedRefresh();
    }
  }

  private startCompletedRefresh(): void {
    if (this.completedHandle) return;
    this.completedHandle = setInterval(() => {
      this.service.loadCompleted().subscribe();
    }, COMPLETED_REFRESH_MS);
  }

  private stopCompletedRefresh(): void {
    if (this.completedHandle) {
      clearInterval(this.completedHandle);
      this.completedHandle = undefined;
    }
  }

  // ── Mutations (delegate to the service) ───────────────────────────────
  onAdvance(t: KitchenTicket): void {
    const next = this.nextOf(t);
    if (next) this.service.advanceStatus(t.id, next);
  }
  onRecall(t: KitchenTicket): void { this.service.recall(t.id); }
  onTogglePriority(t: KitchenTicket): void { this.service.togglePriority(t.id); }
  /** Completed-view recall: served → ready, back onto the active board. */
  onRecallCompleted(t: KitchenTicket): void { this.service.recallCompleted(t.id); }

  // ── Cancel/void (board owns the confirm dialog; service does the call) ─
  onCardCancel(t: KitchenTicket): void { this.cancelTarget.set(t); }
  onCancelConfirm(reason: string): void {
    const t = this.cancelTarget();
    if (t) this.service.cancelOrder(t.id, reason);
    this.cancelTarget.set(null);
  }
  onCancelDismiss(): void { this.cancelTarget.set(null); }

  // ── Sold-out ("86") panel ─────────────────────────────────────────────
  /** Refresh the item list on every open so the panel reflects recent edits. */
  openPanel(): void {
    this.stock.loadItems();
    this.panelOpen.set(true);
  }
  closePanel(): void { this.panelOpen.set(false); }

  private nextOf(t: KitchenTicket) {
    const order: KitchenTicket['fulfilment_status'][] = ['new', 'preparing', 'ready', 'served'];
    const i = order.indexOf(t.fulfilment_status);
    return i >= 0 && i < order.length - 1 ? order[i + 1] : null;
  }

  // ── Pagination / jump controls ────────────────────────────────────────
  goToPage(i: number): void {
    const max = this.pages().length - 1;
    const target = Math.max(0, Math.min(i, max));
    this.currentPage.set(target);
    const el = this.pager?.nativeElement;
    if (el) el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' });
  }
  prevPage(): void { this.goToPage(this.currentPage() - 1); }
  nextPage(): void { this.goToPage(this.currentPage() + 1); }

  onPagerScroll(): void {
    const el = this.pager?.nativeElement;
    if (!el || !el.clientWidth) return;
    this.currentPage.set(Math.round(el.scrollLeft / el.clientWidth));
  }

  /** Jump to the page holding the oldest-created ticket. */
  jumpOldest(): void { this.jumpToTicket(this.indexOfExtreme('oldest')); }
  /** Jump to the page holding the newest-created ticket. */
  jumpNewest(): void { this.jumpToTicket(this.indexOfExtreme('newest')); }
  /** Jump to the page holding the first overdue ticket (sorted order). */
  jumpFirstOverdue(): void {
    const list = this.tickets();
    const now = this.now();
    const idx = list.findIndex(
      t => classifyEscalation(t.created_at, t.served_at, now) === 'overdue',
    );
    this.jumpToTicket(idx);
  }

  get hasOverdue(): boolean {
    const now = this.now();
    return this.tickets().some(
      t => classifyEscalation(t.created_at, t.served_at, now) === 'overdue',
    );
  }

  private indexOfExtreme(which: 'oldest' | 'newest'): number {
    const list = this.tickets();
    if (!list.length) return -1;
    let best = 0;
    for (let i = 1; i < list.length; i++) {
      const a = new Date(list[i].created_at).getTime();
      const b = new Date(list[best].created_at).getTime();
      if (which === 'oldest' ? a < b : a > b) best = i;
    }
    return best;
  }

  private jumpToTicket(index: number): void {
    if (index < 0) return;
    this.goToPage(Math.floor(index / PAGE_SIZE));
  }

  private clampCurrentPage(): void {
    const max = this.pages().length - 1;
    if (this.currentPage() > max) this.currentPage.set(max);
  }

  isEntering(id: string): boolean { return this.enteringIds().has(id); }

  // ── Sound ─────────────────────────────────────────────────────────────
  enableSound(): void {
    try {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.audioCtx = new Ctor();
      void this.audioCtx.resume();
      this.soundArmed.set(true);
      this.chimeNew(); // confirmation blip so staff know it's armed
    } catch {
      this.soundArmed.set(false);
    }
  }

  private onNewTickets(ids: string[]): void {
    // Entry animation
    this.enteringIds.update(set => {
      const next = new Set(set);
      ids.forEach(id => next.add(id));
      return next;
    });
    setTimeout(() => {
      this.enteringIds.update(set => {
        const next = new Set(set);
        ids.forEach(id => next.delete(id));
        return next;
      });
    }, ENTER_MS);
    // Chime (only if armed)
    if (this.soundArmed()) this.chimeNew();
  }

  /**
   * Play a sequence of synthesised notes through the shared AudioContext.
   * Each note is { freq, at } (start offset in seconds) with an optional `dur`
   * (decay end). Same sine + exponential envelope the board has always used —
   * short, distinct, not grating; no audio files.
   */
  private playTones(notes: { freq: number; at: number; dur?: number }[]): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const base = ctx.currentTime;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      const start = base + n.at;
      const dur = n.dur ?? 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    }
  }

  /** New order — neutral rising two-note blip. */
  private chimeNew(): void {
    this.playTones([{ freq: 880, at: 0 }, { freq: 1320, at: 0.12 }]);
  }

  /** Order ready — brighter rising triad; reads as good news, clearly distinct from New. */
  private chimeReady(): void {
    this.playTones([
      { freq: 1047, at: 0 },
      { freq: 1319, at: 0.1 },
      { freq: 1568, at: 0.2 },
    ]);
  }

  /** Overdue — low, repeated double-buzz; insistent, unmistakably distinct from Ready. */
  private chimeOverdue(): void {
    this.playTones([
      { freq: 440, at: 0, dur: 0.22 },
      { freq: 440, at: 0.3, dur: 0.22 },
    ]);
  }

  /**
   * Overdue cue, driven by the 1s ticker (escalation advances with the clock,
   * not with polls, so this cannot live in the emission effect). Fires once as a
   * ticket first crosses into 'overdue'; the first tick seeds silently so a board
   * opened mid-service with already-overdue tickets doesn't blast.
   */
  private detectOverdue(now: number): void {
    // Track the ACTIVE feed regardless of view mode — the Completed view is all
    // served (never overdue), and keeping this on active means the overdue cue
    // (and its fire-once bookkeeping) stays continuous across a view switch.
    const overdue = new Set(
      this.service.activeTickets()
        .filter(t => classifyEscalation(t.created_at, t.served_at, now) === 'overdue')
        .map(t => t.id),
    );
    if (this.overdueFired === null) {
      this.overdueFired = overdue; // first tick: seed without firing
      return;
    }
    if (this.soundArmed()) {
      let newly = false;
      for (const id of overdue) {
        if (!this.overdueFired.has(id)) {
          newly = true;
          break;
        }
      }
      if (newly) this.chimeOverdue();
    }
    // Wholesale rebuild: drops ids that left the list or recovered, so a genuine
    // re-entry can re-alert; still-overdue ids stay, so no per-second re-fire.
    this.overdueFired = overdue;
  }

  // ── Wake lock ─────────────────────────────────────────────────────────
  async toggleWakeLock(): Promise<void> {
    if (this.wakeLockActive() || this.wantWakeLock) {
      this.wantWakeLock = false;
      await this.releaseWakeLock();
    } else {
      this.wantWakeLock = true;
      await this.requestWakeLock();
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!this.wakeLockSupported) return;
    try {
      this.wakeLockSentinel = await (navigator as Navigator).wakeLock.request('screen');
      this.wakeLockActive.set(true);
      this.wakeLockSentinel.addEventListener('release', () => {
        this.wakeLockActive.set(false); // OS may revoke at any time
      });
    } catch {
      // Unavailable / rejected — leave inactive; the re-enable control stays visible.
      this.wakeLockActive.set(false);
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLockSentinel?.release();
    } catch {
      /* ignore */
    }
    this.wakeLockSentinel = null;
    this.wakeLockActive.set(false);
  }

  private handleVisibility(): void {
    // The OS releases the lock when the tab is hidden; re-acquire on return.
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'visible' && this.wantWakeLock && !this.wakeLockActive()) {
      void this.requestWakeLock();
    }
  }
}
