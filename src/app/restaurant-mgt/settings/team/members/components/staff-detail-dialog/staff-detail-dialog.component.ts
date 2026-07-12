import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { EmployeeListUser } from 'src/app/_models/app.models';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { roleLabel } from '../../staff-roles';

/**
 * Read-only staff details. Re-skin of the legacy `CommonUsersComponent` "View"
 * modal. Roles render via `roleLabel` (titlecase fallback) so a legacy finance
 * user still shows "Finance" rather than blank.
 */
@Component({
  selector: 'app-staff-detail-dialog',
  standalone: true,
  imports: [CommonModule, DialogComponent, ButtonComponent],
  templateUrl: './staff-detail-dialog.component.html',
})
export class StaffDetailDialogComponent {
  @Input() open = false;
  @Input() staff: EmployeeListUser | null = null;

  @Output() closed = new EventEmitter<void>();

  readonly roleLabel = roleLabel;

  onClose(): void {
    this.closed.emit();
  }
}
