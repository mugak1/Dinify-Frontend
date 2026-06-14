import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { EmployeeListUser } from 'src/app/_models/app.models';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';

/**
 * Confirm removal of a staff member. Re-skin of the legacy
 * `ConfirmDialogService` delete flow — the deletion reason is still required.
 * "Dumb" dialog: emits `confirmed` with the reason; the parent runs the
 * soft-delete PUT.
 */
@Component({
  selector: 'app-staff-remove-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogComponent],
  templateUrl: './staff-remove-dialog.component.html',
})
export class StaffRemoveDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() staff: EmployeeListUser | null = null;
  @Input() removing = false;

  @Output() cancelled = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<string>();

  reason = '';
  submitted = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.reason = '';
      this.submitted = false;
    }
  }

  onCancel(): void {
    if (this.removing) return;
    this.cancelled.emit();
  }

  onConfirm(): void {
    this.submitted = true;
    const reason = this.reason.trim();
    if (!reason) return;
    this.confirmed.emit(reason);
  }
}
