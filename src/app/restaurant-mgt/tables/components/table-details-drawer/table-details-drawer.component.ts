import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { SheetComponent } from '../../../../_shared/ui/sheet/sheet.component';
import {
  FloorRound,
  FloorRoundDetail,
  FloorStatusAction,
  FloorTable,
  FloorTableDetail,
  RoundCommand,
} from '../../models/floor.models';
import {
  CHIP_CLASSES,
  DECLINE_CONFIRM_BODY,
  DECLINE_CONFIRM_TITLE,
  FULFILMENT_LABEL,
  PAYMENT_UNKNOWN_LABEL,
  STATUS_ACTIONS,
  ageLabel,
  clockLabel,
  minutesSince,
  moneyLabel,
  roundChipTone,
  roundStateLabel,
  tableStatusLabel,
} from '../../utils/floor-presentation';

export type DetailState = 'idle' | 'loading' | 'ready' | 'error';

interface RoundRow {
  round: FloorRound;
  /** Items and makeability; null until the table read has landed. */
  detail: FloorRoundDetail | null;
}

/**
 * The table drawer (Step 2, floor contract v1).
 *
 * It shows a table's rounds with their items, lets staff Confirm or Decline a held
 * round, and offers three status actions — Mark dirty, Mark available, Out of service.
 * Nothing else: seating, transfers, payments, bills, waitlist, server, notes, merge
 * and split are not Step 2 and are not here.
 *
 * Presentational: it decides nothing and calls nothing. Every action is an output the
 * floor view sends to `FloorService`, and every outcome comes back in as an input.
 *
 * Confirm is the view's one primary action (brand red). Decline is destructive and one
 * step away: it asks first. Confirm is offered only once the table's items have loaded,
 * so staff confirm what they have seen, and it is disabled when the round cannot be
 * made.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-table-details-drawer',
  standalone: true,
  imports: [ButtonComponent, BadgeComponent, DialogComponent, SheetComponent],
  templateUrl: './table-details-drawer.component.html',
})
export class TableDetailsDrawerComponent {
  @Input() isOpen = false;
  /** The table as the floor last read it. */
  @Input() table: FloorTable | null = null;
  /** The drawer's own read of the table (items, makeability). */
  @Input() detail: FloorTableDetail | null = null;
  @Input() detailState: DetailState = 'idle';
  /** "Now" on the SERVER's clock, for round ages. */
  @Input() serverNowMs = 0;
  /** Commands in flight, by order id. */
  @Input() pending: Record<string, RoundCommand> = {};
  /** The latest answer that needs saying, by order id (this table's only). */
  @Input() notices: Record<string, string> = {};
  @Input() statusPending: FloorStatusAction | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() confirmRound = new EventEmitter<string>();
  @Output() declineRound = new EventEmitter<string>();
  @Output() setStatus = new EventEmitter<FloorStatusAction>();
  @Output() retryDetail = new EventEmitter<void>();

  readonly statusActions = STATUS_ACTIONS;
  /** "Status unknown" for a stored value outside the five (decision 2). */
  readonly statusLabel = tableStatusLabel;
  readonly fulfilmentLabel = FULFILMENT_LABEL;
  readonly paymentLabel = PAYMENT_UNKNOWN_LABEL;
  readonly declineTitle = DECLINE_CONFIRM_TITLE;
  readonly declineBody = DECLINE_CONFIRM_BODY;

  /** The held round the decline confirmation is asking about. */
  declineTarget: FloorRound | null = null;

  /** The freshest read of this table: the drawer's own once it has landed. */
  get current(): FloorTable | FloorTableDetail | null {
    return this.detailReady ? this.detail : this.table;
  }

  get detailReady(): boolean {
    return this.detailState === 'ready' && !!this.detail && this.detail.id === this.table?.id;
  }

  get rows(): RoundRow[] {
    if (this.detailReady) return this.detail!.rounds.map(r => ({ round: r, detail: r }));
    return (this.table?.rounds ?? []).map(r => ({ round: r, detail: null }));
  }

  /** Answers about rounds that have since left the floor (declined elsewhere, say). */
  get orphanNotices(): string[] {
    const shown = new Set(this.rows.map(r => r.round.orderId));
    return Object.entries(this.notices)
      .filter(([orderId]) => !shown.has(orderId))
      .map(([, text]) => text);
  }

  get hasOrders(): boolean {
    return this.rows.length > 0;
  }

  chipClass(round: FloorRound): string {
    return CHIP_CLASSES[roundChipTone(round)];
  }

  roundLabel(round: FloorRound): string {
    return roundStateLabel(round);
  }

  heldAge(round: FloorRound): string {
    return ageLabel(minutesSince(round.heldSince, this.serverNowMs));
  }

  clock(iso: string | null): string {
    return clockLabel(iso);
  }

  money(value: string): string {
    return moneyLabel(value);
  }

  canConfirm(row: RoundRow): boolean {
    return (
      row.round.state === 'held' &&
      !!row.detail &&
      !row.detail.cannotBeMade &&
      !this.pending[row.round.orderId]
    );
  }

  // ── Actions ────────────────────────────────────────────────────

  onClose(): void {
    this.declineTarget = null;
    this.closed.emit();
  }

  onConfirm(row: RoundRow): void {
    if (!this.canConfirm(row)) return;
    this.confirmRound.emit(row.round.orderId);
  }

  askDecline(row: RoundRow): void {
    if (row.round.state !== 'held' || this.pending[row.round.orderId]) return;
    this.declineTarget = row.round;
  }

  confirmDecline(): void {
    const target = this.declineTarget;
    this.declineTarget = null;
    if (target) this.declineRound.emit(target.orderId);
  }

  onStatus(status: FloorStatusAction): void {
    if (this.statusPending || this.current?.status === status) return;
    this.setStatus.emit(status);
  }
}
