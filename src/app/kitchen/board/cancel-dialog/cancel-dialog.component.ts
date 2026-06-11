import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';

import { KitchenTicket } from '../../models/kitchen.models';
import { formatOrderNumber } from '../../services/kitchen-logic';

/** A structured cancellation reason — values mirror the backend enum exactly. */
interface CancelReason {
  label: string;
  value: string;
}

/**
 * Confirmation modal for voiding a ticket. Presentational: the board owns the
 * open state (via `cancelTarget`) and the service call; this just collects a
 * reason. Pick-to-confirm — tapping a reason fires `confirm` straight away; the
 * prominent "Keep order" button (and the scrim / Escape) backs out safely.
 */
@Component({
  selector: 'app-kitchen-cancel-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cancel-dialog.component.html',
  styleUrls: ['./cancel-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CancelDialogComponent {
  @Input() open = false;
  @Input() order: KitchenTicket | null = null;

  @Output() confirm = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  readonly reasons: CancelReason[] = [
    { label: 'Customer changed mind', value: 'customer_changed_mind' },
    { label: 'Item unavailable', value: 'item_unavailable' },
    { label: 'Kitchen error', value: 'kitchen_error' },
    { label: 'Duplicate', value: 'duplicate' },
    { label: 'Other', value: 'other' },
  ];

  /** Already includes the leading '#' (formatOrderNumber prepends it). */
  get orderNumber(): string {
    return this.order ? formatOrderNumber(this.order.order_number) : '';
  }

  onPick(value: string): void {
    this.confirm.emit(value);
  }

  onClose(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.onClose();
  }
}
