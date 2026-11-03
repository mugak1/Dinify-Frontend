import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, takeUntil, timer } from 'rxjs';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { FloorService } from '../../services/floor.service';
import { ServiceToolbarComponent } from '../service-toolbar/service-toolbar.component';
import { FloorPlanCanvasComponent } from '../floor-plan-canvas/floor-plan-canvas.component';
import { DetailState, TableDetailsDrawerComponent } from '../table-details-drawer/table-details-drawer.component';
import {
  FloorSnapshot,
  FloorStatusAction,
  FloorTable,
  FloorTableDetail,
  FloorTableStatus,
  RoundCommand,
  RoundCommandAnswer,
} from '../../models/floor.models';
import {
  STATUS_ACTIONS,
  commandDoneMessage,
  needsStaffFirst,
  refusalMessage,
  unknownAnswerMessage,
} from '../../utils/floor-presentation';

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
 * PRODUCTION. While `FloorService.USE_MOCK_DATA` is on, `TablesComponent` renders this
 * view only in a development build (see `floor-view-gate.ts`).
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
  /** How often the floor is re-read. `static` so specs can change it. */
  static POLL_MS = 15_000;

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

  constructor(
    private readonly floorService: FloorService,
    private readonly toast: ToastService,
    private readonly auth: AuthenticationService,
  ) {}

  private get restaurantId(): string {
    return this.auth.currentRestaurantRole?.restaurant_id ?? '';
  }

  ngOnInit(): void {
    timer(0, TablesServiceViewComponent.POLL_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.nowMs = Date.now();
        this.refresh();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.floorSub?.unsubscribe();
    this.detailSub?.unsubscribe();
  }

  // ── Reads ──────────────────────────────────────────────────────

  refresh(): void {
    this.floorSub?.unsubscribe();
    this.floorSub = this.floorService.loadFloor(this.restaurantId).subscribe({
      next: read => {
        if (read.kind === 'superseded') return;
        if (read.kind === 'invalid') return this.floorFailed();
        this.floor = read.value;
        this.receivedAtMs = Date.now();
        this.nowMs = this.receivedAtMs;
        this.loadState = 'ready';
        this.refreshFailed = false;
        if (this.selectedTableId) this.loadDetail();
      },
      error: () => this.floorFailed(),
    });
  }

  private floorFailed(): void {
    if (this.floor) this.refreshFailed = true;
    else this.loadState = 'error';
  }

  private loadDetail(): void {
    const tableId = this.selectedTableId;
    if (!tableId) return;
    if (this.detail?.id !== tableId) {
      this.detail = null;
      this.detailState = 'loading';
    }
    this.detailSub?.unsubscribe();
    this.detailSub = this.floorService.loadTable(this.restaurantId, tableId).subscribe({
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
      if (this.statusFilter.length > 0 && !this.statusFilter.includes(t.status)) return false;
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
   * floor is re-read afterwards whatever the answer was.
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
        this.refresh();
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
        this.toast.success(commandDoneMessage(command, roundNumber, answer.changed));
        this.patchDetail(orderId, answer.state);
        return;
      case 'refused':
        this.setNotice(orderId, tableId, refusalMessage(command, answer.reason, answer.itemName));
        return;
      case 'unknown':
        this.setNotice(orderId, tableId, unknownAnswerMessage(command));
        return;
    }
  }

  /**
   * Show the server's answer on the open drawer until the re-read lands: a released
   * round reads "Sent to kitchen", a round that left the floor (declined) goes. Only
   * the STATE the server named is applied; nothing else is invented.
   */
  private patchDetail(orderId: string, state: string): void {
    if (!this.detail) return;
    if (state === 'released') {
      this.detail = {
        ...this.detail,
        rounds: this.detail.rounds.map(r =>
          r.orderId === orderId ? { ...r, state: 'released', heldSince: null, stale: false, cannotBeMade: null } : r,
        ),
      };
    } else if (state !== 'held') {
      this.detail = { ...this.detail, rounds: this.detail.rounds.filter(r => r.orderId !== orderId) };
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
