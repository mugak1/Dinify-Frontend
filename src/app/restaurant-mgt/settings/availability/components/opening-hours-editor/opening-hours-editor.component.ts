import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { DayHours, OpeningHoursDay } from 'src/app/_models/app.models';

import { OPENING_HOURS_DAYS } from '../../opening-hours.constants';

/**
 * Presentational seven-day opening-hours editor. The parent (AvailabilityComponent)
 * owns the FormGroup — a control per day, each a nested group
 * `{ closed, open, close }` with a close-after-open validator — so dirty/validity/
 * value flow straight to the section save bar, exactly like the Tax & receipts form.
 *
 * Each row: day label · "Closed" toggle · native time inputs. Closing a day hides
 * (does not Angular-disable) its inputs and shows "Closed", so the retained
 * open/close stay in `form.value` for the payload and reappear when reopened.
 */
@Component({
  selector: 'app-opening-hours-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SwitchComponent],
  templateUrl: './opening-hours-editor.component.html',
})
export class OpeningHoursEditorComponent {
  /** The hours form built and owned by the parent section. */
  @Input() form!: FormGroup;

  readonly days = OPENING_HOURS_DAYS;

  /** Compact, neutral time-input styling (red ring is carried at the row level). */
  readonly timeInputClass =
    'rounded-md border border-gray-300 px-2 py-1.5 text-sm text-gray-900 ' +
    'focus:outline-none focus:ring-1 focus:border-primary focus:ring-primary';

  private group(key: OpeningHoursDay): FormGroup {
    return this.form.get(key) as FormGroup;
  }

  isClosed(key: OpeningHoursDay): boolean {
    return !!this.group(key).get('closed')?.value;
  }

  /** A row is flagged once its (open) interval is invalid and the user touched it. */
  isRowInvalid(key: OpeningHoursDay): boolean {
    const g = this.group(key);
    return g.invalid && (g.dirty || g.touched);
  }

  /** The switch isn't a ControlValueAccessor — set the control by hand (like Tax). */
  onClosedToggle(key: OpeningHoursDay, value: boolean): void {
    const g = this.group(key);
    g.get('closed')?.setValue(value);
    g.markAsDirty();
    // Closed days are always valid; reopened days re-check close-after-open.
    g.updateValueAndValidity();
  }

  /** Replicate Monday's hours + closed state to every other day. */
  copyMondayToAll(): void {
    const monday = this.group('monday').value as DayHours;
    for (const d of this.days) {
      if (d.key === 'monday') continue;
      const g = this.group(d.key);
      g.setValue({
        closed: monday.closed,
        open: monday.open,
        close: monday.close,
      });
      g.markAsDirty();
    }
    this.form.markAsDirty();
  }
}
