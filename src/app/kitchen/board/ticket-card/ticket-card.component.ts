import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

import {
  EscalationLevel,
  KitchenTicket,
  TicketOperation,
} from '../../models/kitchen.models';
import {
  ModifierKind,
  classifyEscalation,
  classifyModifier,
  formatAge,
  formatOrderNumber,
  formatServedAgo,
  isRecallEligible,
  nextStatus,
} from '../../services/kitchen-logic';
import { getTagIconSvg } from '../../../_shared/tags/tag-palette';

/**
 * Allergen chip treatments. Full class literals (not built at runtime) so
 * Tailwind's JIT scanner picks them up. The palette `colour` names come from the
 * shared tag palette; we render a tinted chip with a border so each stays
 * readable on the white card.
 */
const ALLERGEN_CHIP: Record<string, string> = {
  red: 'bg-red-100 text-red-800 border-red-300',
  orange: 'bg-orange-100 text-orange-800 border-orange-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  green: 'bg-green-100 text-green-800 border-green-300',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  cyan: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  blue: 'bg-blue-100 text-blue-800 border-blue-300',
  purple: 'bg-purple-100 text-purple-800 border-purple-300',
  rose: 'bg-rose-100 text-rose-800 border-rose-300',
  gray: 'bg-gray-100 text-gray-700 border-gray-300',
};

@Component({
  selector: 'app-kitchen-ticket-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ticket-card.component.html',
  styleUrls: ['./ticket-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TicketCardComponent {
  @Input({ required: true }) ticket!: KitchenTicket;
  /** Shared clock from the board (single ticker, no per-card timers). */
  @Input({ required: true }) now = 0;
  /** Whether the current user may void a ticket past 'new' (owner/manager). */
  @Input() isManager = false;
  /**
   * Read-only Completed mode: neutral header (no urgency tint), a muted
   * "served {relative}" in place of the live age, no cancel/priority/advance —
   * just a single Recall action. Items render exactly as in the active card.
   */
  @Input() completed = false;
  /**
   * The unresolved command against THIS ticket, if any (D05). The card shows
   * what is happening and disables further commands on it — it does NOT
   * disappear or roll back, because a command whose outcome is unknown must not
   * be presented as one that failed.
   */
  @Input() operation: TicketOperation | null = null;
  /**
   * Whether the server has declared a kitchen command protocol this client can
   * speak. False means READ-ONLY: the controls are withheld rather than falling
   * back to a form the server would not enforce.
   */
  @Input() canCommand = true;

  @Output() advance = new EventEmitter<KitchenTicket>();
  @Output() recall = new EventEmitter<KitchenTicket>();
  @Output() togglePriority = new EventEmitter<KitchenTicket>();
  // Not `cancel`: that's a native DOM event (@angular-eslint/no-output-native).
  @Output() cancelRequested = new EventEmitter<KitchenTicket>();
  /** The operator has read a SETTLED notice (a refusal, or a reconciled state)
   *  and dismissed it. An open question is not dismissible — see `canDismiss`. */
  @Output() acknowledge = new EventEmitter<KitchenTicket>();
  /** Ask the server what this order is now, to settle an unknown outcome. */
  @Output() checkRequested = new EventEmitter<KitchenTicket>();
  /** Re-send the SAME command under its ORIGINAL precondition. */
  @Output() retryRequested = new EventEmitter<KitchenTicket>();

  // ── D05 command state ───────────────────────────────────────────────
  /** A command is in flight: the controls are inert and the card says so. */
  get isPending(): boolean {
    return this.operation?.phase === 'pending';
  }

  /** The server refused, and told us what the ticket actually is. */
  get isConflict(): boolean {
    return this.operation?.phase === 'conflict';
  }

  /** We could not confirm the outcome. NOT the same as "it failed". */
  get isUnknown(): boolean {
    return this.operation?.phase === 'unknown';
  }

  /** A reconciliation read is in flight against an unknown outcome. */
  get isChecking(): boolean {
    return this.operation?.phase === 'checking';
  }

  /** Reconciled: the order's CURRENT state is known. Deliberately not a claim
   *  that this command caused it — see the service's `describeState`. */
  get isResolved(): boolean {
    return this.operation?.phase === 'resolved';
  }

  /** The server may still have acted, so the operator is offered recovery
   *  rather than a dismissal. */
  get isOpenQuestion(): boolean {
    return this.isUnknown || this.isChecking;
  }

  /**
   * ONLY A SETTLED NOTICE MAY BE DISMISSED. A refusal the server stated, and a
   * reconciled current state, are both finished. An `unknown` is not: OK on it
   * used to DELETE the operation, which quietly meant "abandon whatever the
   * server did with this command".
   */
  get canDismiss(): boolean {
    return this.isConflict || this.isResolved;
  }

  /** One sentence for whichever unresolved state this card is in. */
  get operationNotice(): string | null {
    const op = this.operation;
    if (!op) return null;
    if (op.phase === 'pending') return `${op.label}…`;
    if (op.phase === 'checking') return op.message ?? 'Checking with the kitchen server…';
    return op.message
      ?? 'This ticket changed. The board is showing its current state.';
  }

  /**
   * Commands are withheld while THE ANSWER IS OUTSTANDING — not merely while a
   * request is in flight. `!isPending` was the old test, so a lost reply left
   * the card open to a fresh command at a refreshed revision: a different
   * question asked as though it were the same one.
   */
  get commandsEnabled(): boolean {
    return this.canCommand && !this.isPending && !this.isOpenQuestion;
  }

  onAcknowledge(): void {
    this.acknowledge.emit(this.ticket);
  }

  onCheck(): void {
    this.checkRequested.emit(this.ticket);
  }

  onRetry(): void {
    this.retryRequested.emit(this.ticket);
  }

  get orderNumber(): string {
    return formatOrderNumber(this.ticket.order_number);
  }

  get age(): string {
    return formatAge(this.ticket.created_at, this.now);
  }

  /** Completed-mode age line: "served 3m ago", or null when no served stamp. */
  get servedRelative(): string | null {
    if (!this.ticket.served_at) return null;
    return `served ${formatServedAgo(this.ticket.served_at, this.now)}`;
  }

  get escalation(): EscalationLevel {
    return classifyEscalation(this.ticket.created_at, this.ticket.served_at, this.now);
  }

  get next() {
    return nextStatus(this.ticket.fulfilment_status);
  }

  /** Label for the primary advance action. */
  get advanceLabel(): string {
    switch (this.ticket.fulfilment_status) {
      case 'new': return 'Start';
      case 'preparing': return 'Ready';
      case 'ready': return 'Served';
      default: return '';
    }
  }

  get canRecall(): boolean {
    // The SERVER enforces the recall window; this only spares an operator a
    // round trip they can already see will be refused. It now gates the
    // Completed card too — that button used to render unconditionally, which is
    // why the ten-minute rule was dead in the shipped UI.
    return this.commandsEnabled && isRecallEligible(this.ticket, this.now);
  }

  get isServed(): boolean {
    return this.ticket.fulfilment_status === 'served';
  }

  /**
   * Cancel availability, mirroring the backend gate: free while 'new' (any
   * kitchen user), manager-only once 'preparing'/'ready', never once 'served'
   * (recall it first).
   */
  get canCancel(): boolean {
    if (!this.commandsEnabled) return false;
    if (this.isServed) return false;
    if (this.ticket.fulfilment_status === 'new') return true;
    return this.isManager;
  }

  get isServerAssisted(): boolean {
    return this.ticket.order_source === 'server_assisted';
  }

  allergenChip(colour: string): string {
    return ALLERGEN_CHIP[colour] ?? ALLERGEN_CHIP['gray'];
  }

  /** Resolve an allergen icon name to inline SVG (shared Lucide catalog). */
  iconSvg(name: string): string {
    return getTagIconSvg(name);
  }

  /** Classify a freeform modifier for typed display (red / blue / chip / plain). */
  modType(m: string): ModifierKind {
    return classifyModifier(m);
  }

  onAdvance(): void {
    if (this.next) this.advance.emit(this.ticket);
  }

  onRecall(): void {
    this.recall.emit(this.ticket);
  }

  onTogglePriority(): void {
    this.togglePriority.emit(this.ticket);
  }

  onCancel(): void {
    this.cancelRequested.emit(this.ticket);
  }
}
