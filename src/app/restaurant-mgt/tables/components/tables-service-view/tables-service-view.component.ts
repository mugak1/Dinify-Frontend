import { ChangeDetectionStrategy, Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, finalize, takeUntil } from 'rxjs';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { FloorService } from '../../services/floor.service';
import { FLOOR_PAGE_VISIBILITY, FloorPageVisibility } from '../../services/floor-page-visibility';
import { ServiceToolbarComponent } from '../service-toolbar/service-toolbar.component';
import { FloorPlanCanvasComponent } from '../floor-plan-canvas/floor-plan-canvas.component';
import { DetailState, TableDetailsDrawerComponent } from '../table-details-drawer/table-details-drawer.component';
import {
  CannotBeMade,
  CommandRound,
  FloorRound,
  FloorSnapshot,
  FloorStatusAction,
  FloorTable,
  FloorTableDetail,
  FloorTableStatus,
  RoundCommand,
  RoundCommandAnswer,
} from '../../models/floor.models';
import {
  ORDER_GONE_MESSAGE,
  STATUS_ACTIONS,
  commandDoneMessage,
  needsStaffFirst,
  refusalMessage,
  unknownAnswerMessage,
} from '../../utils/floor-presentation';

/**
 * Put the server's round in place of ours, or drop ours when the server says the round
 * has left the floor (A-4: declined, cancelled, served or draft). Only what the server
 * stated is applied; a held round keeps its items and takes the refusal's
 * `cannot_be_made` when it carried one.
 */
function withRound<R extends FloorRound>(
  rounds: R[],
  answer: CommandRound,
  patch: (current: R, live: FloorRound) => R,
): R[] {
  if (answer.state !== 'held' && answer.state !== 'released') {
    return rounds.filter(r => r.orderId !== answer.orderId);
  }
  const live = answer as FloorRound;
  return rounds.map(r => (r.orderId === answer.orderId ? patch(r, live) : r));
}

/** A copy of `record` without `key` (records here are replaced, never mutated). */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

interface Notice {
  tableId: string;
  text: string;
}

/**
 * The floor view (Step 2) — the Tables page's Service view, rebuilt on floor contract
 * v1 and `FloorService`.
 *
 * WHAT IT SHOWS: every table's state with its held and released rounds, the age of
 * held rounds and the stale flag; tables that need staff first; a search, a status
 * filter and the "N waiting" count; and the table drawer, where a held round is
 * confirmed or declined and a table is marked dirty, available or out of service.
 *
 * WHAT IT DOES NOT. Reservations, the waitlist, seating, transfers, servers, notes,
 * merge/split and anything about payment are not Step 2. Their components stay parked
 * in the repo and none of them is rendered here. Step 2 records no payment, so nothing
 * on this screen says a payment was taken or recorded: a bill reads "Payment unknown".
 *
 * LIVE (FE-C). It reads BE-D's floor endpoints. REFRESHING (decision 5): the floor is
 * re-read every `POLL_MS` (5 s) while the tab is visible, backing off to
 * `BACKOFF_MS` after consecutive failed reads and snapping back on the first good
 * one — the kitchen board's pattern. Nothing is read while the tab is hidden, and the
 * floor is read at once when it becomes visible again. The open drawer is re-read when
 * it opens, after every command and with each floor read.
 *
 * COMMANDS (decision 6). Confirm and Decline mark the round pending, and nothing else.
 * On 200 the view takes the returned round; on 409 it shows the reason's copy and
 * replaces its round with `data.round`; on 404 it says "This order is no longer
 * available."; and in every case it re-reads the floor and the drawer. Resending is
 * safe by contract, so there is no unconfirmed-command store.
 *
 * PRODUCTION. While `FloorService.USE_MOCK_DATA` is on, `TablesComponent` renders this
 * view only in a development build (see `floor-view-gate.ts`); it is off, so this is
 * the live view.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-tables-service-view',
  standalone: true,
  imports: [ServiceToolbarComponent, FloorPlanCanvasComponent, TableDetailsDrawerComponent],
  templateUrl: './tables-service-view.component.html',
  host: { class: 'block' },
})
export class TablesServiceViewComponent implements OnInit, OnDestroy {
  /** How often the floor is re-read while the tab is visible. `static` so specs can change it. */
  static POLL_MS = 5_000;
  /** The delay after 1, then 2 or more, consecutive failed reads. Snaps back on success. */
  static BACKOFF_MS: readonly number[] = [10_000, 20_000];

  readonly usingMockData = FloorService.USE_MOCK_DATA;

  floor: FloorSnapshot | null = null;
  loadState: 'loading' | 'ready' | 'error' = 'loading';
  /** A read failed after a floor was already showing; the last good floor stays. */
  refreshFailed = false;

  search = '';
  statusFilter: FloorTableStatus[] = [];

  selectedTableId: string | null = null;
  detail: FloorTableDetail | null = null;
  detailState: DetailState = 'idle';

  pending: Record<string, RoundCommand> = {};
  private notices: Record<string, Notice> = {};
  statusPending: FloorStatusAction | null = null;

  /** Device time the last floor landed, to advance the SERVER's clock between reads. */
  private receivedAtMs = 0;
  private nowMs = Date.now();

  private readonly destroy$ = new Subject<void>();
  private floorSub: Subscription | null = null;
  private detailSub: Subscription | null = null;
  /** The table whose drawer read is in flight, if any. */
  private detailInFlightFor: string | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  /** Consecutive failed floor reads; drives the back-off. */
  private failures = 0;
  private destroyed = false;

  constructor(
    private readonly floorService: FloorService,
    private readonly toast: ToastService,
    private readonly auth: AuthenticationService,
    @Inject(FLOOR_PAGE_VISIBILITY) private readonly visibility: FloorPageVisibility,
  ) {}

  private get restaurantId(): string {
    return this.auth.currentRestaurantRole?.restaurant_id ?? '';
  }

  ngOnInit(): void {
    this.visibility.changes.pipe(takeUntil(this.destroy$)).subscribe(() => this.onVisibilityChange());
    // A view opened in a hidden tab (a restored session, say) reads when it is shown.
    if (!this.visibility.hidden()) this.refresh();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearPoll();
    this.destroy$.next();
    this.destroy$.complete();
    this.floorSub?.unsubscribe();
    this.detailSub?.unsubscribe();
  }

  // ── Polling ────────────────────────────────────────────────────

  /** Hidden: stop scheduling. Visible again: read at once, which resumes the cycle. */
  private onVisibilityChange(): void {
    if (this.visibility.hidden()) {
      this.clearPoll();
    } else {
      this.refresh();
    }
  }

  private clearPoll(): void {
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /** Schedule the next read. Never while hidden or after destroy. */
  private scheduleNext(): void {
    this.clearPoll();
    if (this.destroyed || this.visibility.hidden()) return;
    this.pollHandle = setTimeout(() => {
      this.pollHandle = null;
      this.refresh();
    }, this.nextDelayMs());
  }

  private nextDelayMs(): number {
    if (this.failures === 0) return TablesServiceViewComponent.POLL_MS;
    const backoff = TablesServiceViewComponent.BACKOFF_MS;
    return backoff[Math.min(this.failures, backoff.length) - 1];
  }

  // ── Reads ──────────────────────────────────────────────────────

  /**
   * Read the floor now and schedule the next read from when this one settles. Called
   * by the poll, by "Try again", by a visibility change and after every command, so the
   * cycle always restarts from the latest read rather than stacking timers.
   *
   * `reloadDetail` re-reads the open drawer once the floor lands. A command passes
   * false and re-reads the drawer itself, at once.
   */
  refresh(reloadDetail = true): void {
    if (this.destroyed) return;
    this.clearPoll();
    this.nowMs = Date.now();
    this.floorSub?.unsubscribe();
    this.floorSub = this.floorService.loadFloor(this.restaurantId).subscribe({
      next: read => {
        if (read.kind === 'invalid') {
          this.floorFailed();
        } else if (read.kind === 'ok') {
          this.floor = read.value;
          this.receivedAtMs = Date.now();
          this.nowMs = this.receivedAtMs;
          this.loadState = 'ready';
          this.refreshFailed = false;
          this.failures = 0;
          if (reloadDetail && this.selectedTableId) this.loadDetail({ force: false });
        }
        // `superseded` is an answer older than a command answer: the view keeps what
        // it has, and it is not a failure.
        this.scheduleNext();
      },
      error: () => {
        this.floorFailed();
        this.scheduleNext();
      },
    });
  }

  private floorFailed(): void {
    this.failures++;
    if (this.floor) this.refreshFailed = true;
    else this.loadState = 'error';
  }

  /**
   * Read the open table for the drawer.
   *
   * `force: false` is the POLL's re-read, and it leaves a read of the same table that is
   * still in flight alone. Otherwise a table read slower than the 5 s poll (but inside
   * its 8 s timeout) would be cancelled by every poll and never land, leaving the drawer
   * on "loading items…" with Confirm unavailable. Opening the drawer, a command and
   * "Try again" force a fresh read, replacing any older one in flight.
   */
  private loadDetail({ force }: { force: boolean } = { force: true }): void {
    const tableId = this.selectedTableId;
    if (!tableId) return;
    if (!force && this.detailInFlightFor === tableId) return;
    if (this.detail?.id !== tableId) {
      this.detail = null;
      this.detailState = 'loading';
    }
    this.detailSub?.unsubscribe();
    this.detailInFlightFor = tableId;
    this.detailSub = this.floorService.loadTable(this.restaurantId, tableId).pipe(
      finalize(() => {
        if (this.detailInFlightFor === tableId) this.detailInFlightFor = null;
      }),
    ).subscribe({
      next: read => {
        if (read.kind === 'superseded' || this.selectedTableId !== tableId) return;
        if (read.kind === 'invalid') {
          this.detailState = 'error';
          return;
        }
        this.detail = read.value;
        this.detailState = 'ready';
      },
      error: () => {
        if (this.selectedTableId === tableId) this.detailState = 'error';
      },
    });
  }

  // ── Derived ────────────────────────────────────────────────────

  /**
   * Tables that need staff first, then the rest, filtered. MEMOISED on its inputs:
   * it is bound to the canvas, and a fresh array on every check would throw NG0100
   * in a development build.
   */
  get visibleTables(): FloorTable[] {
    const key = { floor: this.floor, search: this.search, filter: this.statusFilter };
    const c = this.visibleCache;
    if (c && c.floor === key.floor && c.search === key.search && c.filter === key.filter) return c.value;
    const q = this.search.trim().toLowerCase();
    const value = needsStaffFirst(this.floor?.tables ?? []).filter(t => {
      // A table whose status is unknown matches no status filter (decision 2).
      if (this.statusFilter.length > 0 && !(this.statusFilter as readonly string[]).includes(t.status)) return false;
      if (q && !t.displayName.toLowerCase().includes(q) && !String(t.number).includes(q)) return false;
      return true;
    });
    this.visibleCache = { ...key, value };
    return value;
  }
  private visibleCache: { floor: FloorSnapshot | null; search: string; filter: FloorTableStatus[]; value: FloorTable[] } | null = null;

  get filtering(): boolean {
    return this.search.trim() !== '' || this.statusFilter.length > 0;
  }

  /** "Now" on the server's clock: its `server_time` advanced by the time since it landed. */
  get serverNowMs(): number {
    if (!this.floor) return 0;
    return Date.parse(this.floor.serverTime) + (this.nowMs - this.receivedAtMs);
  }

  get selectedTable(): FloorTable | null {
    return this.floor?.tables.find(t => t.id === this.selectedTableId) ?? null;
  }

  /** The notices for the open table only. Memoised for the same reason as `visibleTables`. */
  get selectedNotices(): Record<string, string> {
    const c = this.noticeCache;
    if (c && c.notices === this.notices && c.tableId === this.selectedTableId) return c.value;
    const value: Record<string, string> = {};
    for (const [orderId, n] of Object.entries(this.notices)) {
      if (n.tableId === this.selectedTableId) value[orderId] = n.text;
    }
    this.noticeCache = { notices: this.notices, tableId: this.selectedTableId, value };
    return value;
  }
  private noticeCache: { notices: Record<string, Notice>; tableId: string | null; value: Record<string, string> } | null = null;

  // ── Selection ──────────────────────────────────────────────────

  onTableSelect(tableId: string): void {
    if (this.selectedTableId === tableId) return;
    this.selectedTableId = tableId;
    this.statusPending = null;
    this.loadDetail();
  }

  onCloseDrawer(): void {
    this.detailSub?.unsubscribe();
    this.selectedTableId = null;
    this.detail = null;
    this.detailState = 'idle';
    this.statusPending = null;
  }

  // ── Commands ───────────────────────────────────────────────────

  onConfirm(orderId: string): void {
    this.run(orderId, 'confirm');
  }

  onDecline(orderId: string): void {
    this.run(orderId, 'decline');
  }

  /**
   * Mark the round pending, send the command, then show the SERVER's answer. Nothing
   * is assumed in between: the round stays as it was until the answer lands, and the
   * floor and the open drawer are re-read afterwards whatever the answer was.
   */
  private run(orderId: string, command: RoundCommand): void {
    const tableId = this.selectedTableId;
    if (!tableId || this.pending[orderId]) return;
    const roundNumber =
      this.detail?.rounds.find(r => r.orderId === orderId)?.roundNumber ??
      this.selectedTable?.rounds.find(r => r.orderId === orderId)?.roundNumber ??
      0;
    this.pending = { ...this.pending, [orderId]: command };
    this.clearNotice(orderId);

    this.floorService
      .command(this.restaurantId, orderId, command)
      .pipe(takeUntil(this.destroy$))
      .subscribe(answer => {
        this.pending = without(this.pending, orderId);
        this.applyAnswer(tableId, orderId, roundNumber, command, answer);
        this.refresh(false);
        this.loadDetail();
      });
  }

  private applyAnswer(
    tableId: string,
    orderId: string,
    roundNumber: number,
    command: RoundCommand,
    answer: RoundCommandAnswer,
  ): void {
    switch (answer.kind) {
      case 'ok':
        this.toast.success(commandDoneMessage(command, answer.round.roundNumber || roundNumber, answer.changed));
        this.applyRound(answer.round, null);
        return;
      case 'refused':
        this.setNotice(orderId, tableId, refusalMessage(command, answer.reason, answer.itemName));
        // A-5: the 409 says where the round now is. Without a readable `data.round`
        // nothing is replaced, and the re-read settles it.
        if (answer.round) this.applyRound(answer.round, answer.cannotBeMade);
        return;
      case 'gone':
        this.setNotice(orderId, tableId, ORDER_GONE_MESSAGE);
        return;
      case 'unknown':
        this.setNotice(orderId, tableId, unknownAnswerMessage(command));
        return;
    }
  }

  /**
   * Take the server's round (a 200's `round`, a 409's `data.round`) on the floor and in
   * the open drawer until the re-reads land. A round that has left the floor goes.
   */
  private applyRound(answer: CommandRound, cannotBeMade: CannotBeMade | null): void {
    if (this.floor) {
      this.floor = {
        ...this.floor,
        tables: this.floor.tables.map(t =>
          t.rounds.some(r => r.orderId === answer.orderId)
            ? { ...t, rounds: withRound(t.rounds, answer, (_r, live) => live) }
            : t,
        ),
      };
    }
    if (this.detail) {
      this.detail = {
        ...this.detail,
        rounds: withRound(this.detail.rounds, answer, (r, live) => ({
          ...live,
          items: r.items,
          cannotBeMade: live.state === 'held' ? (cannotBeMade ?? r.cannotBeMade) : null,
        })),
      };
    }
  }

  onSetStatus(status: FloorStatusAction): void {
    const table = this.selectedTable;
    if (!table || this.statusPending) return;
    this.statusPending = status;
    const done = STATUS_ACTIONS.find(a => a.status === status)?.done ?? 'updated';
    this.floorService
      .setTableStatus(this.restaurantId, table.id, status)
      .pipe(takeUntil(this.destroy$))
      .subscribe(answer => {
        this.statusPending = null;
        if (answer.kind === 'ok') {
          this.toast.success(`${table.displayName} ${done}`);
        } else if (answer.kind === 'refused') {
          this.toast.error(`${table.displayName} wasn’t updated. ${answer.message}`);
        } else {
          this.toast.error(`We couldn’t get an answer about ${table.displayName}. Check the floor and try again.`);
        }
        this.refresh();
      });
  }

  onRetryDetail(): void {
    this.loadDetail();
  }

  private setNotice(orderId: string, tableId: string, text: string): void {
    this.notices = { ...this.notices, [orderId]: { tableId, text } };
  }

  private clearNotice(orderId: string): void {
    this.notices = without(this.notices, orderId);
  }
}
