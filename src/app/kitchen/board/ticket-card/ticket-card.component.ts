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

  @Output() advance = new EventEmitter<KitchenTicket>();
  @Output() recall = new EventEmitter<KitchenTicket>();
  @Output() togglePriority = new EventEmitter<KitchenTicket>();
  // Not `cancel`: that's a native DOM event (@angular-eslint/no-output-native).
  @Output() cancelRequested = new EventEmitter<KitchenTicket>();

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
    return isRecallEligible(this.ticket, this.now);
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
