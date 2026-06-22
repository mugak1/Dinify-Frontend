import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';

/**
 * Persistent, non-dismissable dialog that surfaces the one-time temporary
 * password returned when a brand-new employee is created. The password CANNOT
 * be re-displayed once dismissed (regenerate is deferred — delete + re-create
 * is the only recovery), so this dialog takes extra care:
 *  - the host `app-dn-dialog` runs with `disableClose`, so backdrop clicks and
 *    Escape are inert; the only way out is the acknowledged "Done" button;
 *  - copy failures are handled LOUDLY (more care than the re-displayable
 *    QR/tables copy precedent): the password stays selectable for manual copy
 *    and we show an error toast — never a false "copied" success.
 */
@Component({
  selector: 'app-staff-credential-dialog',
  standalone: true,
  imports: [CommonModule, DialogComponent, ButtonComponent],
  templateUrl: './staff-credential-dialog.component.html',
})
export class StaffCredentialDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() name = '';
  @Input() tempPassword = '';

  @Output() closed = new EventEmitter<void>();

  @ViewChild('pw') pwInput?: ElementRef<HTMLInputElement>;

  acknowledged = false;

  constructor(private toast: ToastService) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Reset the acknowledgement each time the dialog (re)opens so a fresh
    // member never inherits the previous "I've saved this" state.
    if (changes['open'] && this.open) {
      this.acknowledged = false;
    }
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.tempPassword);
      this.toast.success('Password copied to clipboard');
    } catch {
      // The credential can't be re-shown, so a silent copy failure would lose
      // it forever. Keep it selectable and tell the user to copy it manually.
      this.pwInput?.nativeElement.select();
      this.toast.error('Copy failed — select and copy the password manually');
    }
  }

  done(): void {
    if (!this.acknowledged) return;
    this.closed.emit();
  }
}
