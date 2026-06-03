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
  classifyEscalation,
  formatAge,
  formatOrderNumber,
  isRecallEligible,
  nextStatus,
} from '../../services/kitchen-logic';
import { getTagIconSvg } from '../../../_shared/tags/tag-palette';

/**
 * Dark-legible allergen chip treatments. Full class literals (not built at
 * runtime) so Tailwind's JIT scanner picks them up. The palette `colour` names
 * come from the shared tag palette; we render a tinted chip with a border so
 * each stays readable on the 6%-lightness KDS background.
 */
const ALLERGEN_CHIP: Record<string, string> = {
  red: 'bg-red-500/20 text-red-200 border-red-500/40',
  orange: 'bg-orange-500/20 text-orange-200 border-orange-500/40',
  amber: 'bg-amber-500/20 text-amber-100 border-amber-500/40',
  yellow: 'bg-yellow-400/20 text-yellow-100 border-yellow-400/40',
  green: 'bg-green-500/20 text-green-200 border-green-500/40',
  emerald: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  cyan: 'bg-cyan-500/20 text-cyan-100 border-cyan-500/40',
  blue: 'bg-blue-500/20 text-blue-100 border-blue-500/40',
  purple: 'bg-purple-500/20 text-purple-100 border-purple-500/40',
  rose: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  gray: 'bg-white/10 text-gray-200 border-white/20',
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

  @Output() advance = new EventEmitter<KitchenTicket>();
  @Output() recall = new EventEmitter<KitchenTicket>();
  @Output() togglePriority = new EventEmitter<KitchenTicket>();

  get orderNumber(): string {
    return formatOrderNumber(this.ticket.order_number);
  }

  get age(): string {
    return formatAge(this.ticket.created_at, this.now);
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

  onAdvance(): void {
    if (this.next) this.advance.emit(this.ticket);
  }

  onRecall(): void {
    this.recall.emit(this.ticket);
  }

  onTogglePriority(): void {
    this.togglePriority.emit(this.ticket);
  }
}
