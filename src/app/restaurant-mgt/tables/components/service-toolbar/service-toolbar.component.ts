import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { FloorTableStatus } from '../../models/floor.models';
import { STATUS_FILTER_OPTIONS } from '../../utils/floor-presentation';

/**
 * The floor view's toolbar (Step 2): the "N waiting" count, a table search and a
 * status filter. The count is the server's `waiting_for_staff`, shown as sent.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-service-toolbar',
  standalone: true,
  imports: [FormsModule, BadgeComponent],
  templateUrl: './service-toolbar.component.html',
})
export class ServiceToolbarComponent {
  @Input() search = '';
  @Input() statuses: FloorTableStatus[] = [];
  /** The server's `waiting_for_staff`; null before the first read. */
  @Input() waiting: number | null = null;
  @Output() searchChange = new EventEmitter<string>();
  @Output() statusesChange = new EventEmitter<FloorTableStatus[]>();

  readonly statusOptions = STATUS_FILTER_OPTIONS;
  showStatusDropdown = false;

  toggleStatus(status: FloorTableStatus): void {
    const updated = this.statuses.includes(status)
      ? this.statuses.filter(s => s !== status)
      : [...this.statuses, status];
    this.statusesChange.emit(updated);
  }

  clearStatuses(): void {
    this.statusesChange.emit([]);
  }
}
