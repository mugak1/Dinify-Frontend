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

import { ConnectionState, KitchenTicket } from '../models/kitchen.models';
import { classifyEscalation } from '../services/kitchen-logic';
import { KitchenOrderService } from '../services/kitchen-order.service';
import { TicketCardComponent } from './ticket-card/ticket-card.component';

/** Cards per page in the snap grid (4 cols × 2 rows, tablet-landscape). */
const PAGE_SIZE = 8;
/** How long a freshly-arrived card plays its entry animation. */
const ENTER_MS = 700;

@Component({
  selector: 'app-kitchen-board',
  standalone: true,
  imports: [CommonModule, TicketCardComponent],
  templateUrl: './board.component.html',
  styleUrls: ['./board.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardComponent implements OnInit, OnDestroy {
  @ViewChild('pager') pager?: ElementRef<HTMLElement>;

  /** Shared clock — one ticker drives every card's age (no per-card timers). */
  readonly now = signal(Date.now());

  /** Sorted, board-ordered tickets straight from the service signal. */
  readonly tickets = computed(() => this.service.activeTickets());

  /** Tickets chunked into fixed-size pages for the snap grid. */
  readonly pages = computed<KitchenTicket[][]>(() => {
    const all = this.tickets();
    const out: KitchenTicket[][] = [];
    for (let i = 0; i < all.length; i += PAGE_SIZE) out.push(all.slice(i, i + PAGE_SIZE));
    return out.length ? out : [[]];
  });

  readonly currentPage = signal(0);

  /** IDs currently playing the entry animation. */
  readonly enteringIds = signal<Set<string>>(new Set());

  // ── Sound (gated behind a one-time tap; autoplay policy) ──────────────
  readonly soundArmed = signal(false);
  private audioCtx: AudioContext | null = null;

  // ── Screen Wake Lock (progressive enhancement) ────────────────────────
  readonly wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  readonly wakeLockActive = signal(false);
  private wantWakeLock = false;
  private wakeLockSentinel: WakeLockSentinel | null = null;

  private tickHandle?: ReturnType<typeof setInterval>;
  /** Previous ticket-ID set; null until the first load so we never chime on boot. */
  private prevIds: Set<string> | null = null;
  private readonly onVisibility = () => this.handleVisibility();

  constructor(public readonly service: KitchenOrderService) {
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
      }
      this.prevIds = ids;
    });
  }

  ngOnInit(): void {
    this.service.loadActive().subscribe();
    this.tickHandle = setInterval(() => {
      const t = Date.now();
      this.now.set(t);
      this.service.pruneServed(t);
      this.clampCurrentPage();
    }, 1000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  ngOnDestroy(): void {
    if (this.tickHandle) clearInterval(this.tickHandle);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    void this.releaseWakeLock();
    void this.audioCtx?.close();
  }

  // ── Mutations (delegate to the service) ───────────────────────────────
  onAdvance(t: KitchenTicket): void {
    const next = this.nextOf(t);
    if (next) this.service.advanceStatus(t.id, next);
  }
  onRecall(t: KitchenTicket): void { this.service.recall(t.id); }
  onTogglePriority(t: KitchenTicket): void { this.service.togglePriority(t.id); }

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

  // ── Connection indicator (dev toggle in Phase 1) ──────────────────────
  cycleConnection(): void {
    const order: ConnectionState[] = ['connected', 'reconnecting', 'offline'];
    const i = order.indexOf(this.service.connectionState());
    this.service.simulateConnectionState(order[(i + 1) % order.length]);
  }

  injectTicket(): void { this.service.injectNewTicket(); }

  // ── Sound ─────────────────────────────────────────────────────────────
  enableSound(): void {
    try {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.audioCtx = new Ctor();
      void this.audioCtx.resume();
      this.soundArmed.set(true);
      this.chime(); // confirmation blip so staff know it's armed
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
    if (this.soundArmed()) this.chime();
  }

  private chime(): void {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Two-note blip — short, distinct, not grating.
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
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
