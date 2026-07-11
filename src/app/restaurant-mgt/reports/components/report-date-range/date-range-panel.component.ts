// The shared picker body, used in BOTH the desktop popover and the mobile bottom
// sheet (chosen via `variant`). It OWNS the staged selection: preset clicks and
// calendar picks mutate `staged` only — nothing is committed until Apply emits.
// A fresh instance is created each time a surface opens, so ngOnChanges re-seeds
// `staged` from `initial`.

import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { parseISO } from 'date-fns';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import {
  ReportDateRange,
  ReportPreset,
  REPORT_PRESETS,
  presetToRange,
} from '../../models/reports.models';
import { RangeCalendarComponent } from './range-calendar.component';
import { PRESET_LABELS, formatRangeSummary } from './range-label';

@Component({
  selector: 'app-date-range-panel',
  standalone: true,
  imports: [CommonModule, A11yModule, ButtonComponent, RangeCalendarComponent],
  template: `
    <div
      class="bg-popover text-popover-foreground"
      [ngClass]="variant === 'popover' ? 'rounded-lg border border-border shadow-lg p-4' : 'flex flex-col p-4'"
      [cdkTrapFocus]="variant === 'popover'"
      [cdkTrapFocusAutoCapture]="variant === 'popover'"
      [attr.role]="variant === 'popover' ? 'dialog' : null"
      [attr.aria-modal]="variant === 'popover' ? 'true' : null"
      [attr.aria-label]="variant === 'popover' ? 'Select date range' : null"
    >
      <div [ngClass]="variant === 'popover' ? 'flex gap-4' : 'flex flex-col gap-3'">
        <!-- Presets: a left-aligned vertical list in the popover (plain buttons so
             the active red treatment isn't fighting the shared button's host
             classes), a wrapping pill row in the sheet. -->
        @if (variant === 'popover') {
          <div class="flex flex-col gap-1 w-32 shrink-0">
            @for (p of presets; track p) {
              <button
                type="button"
                class="w-full rounded-md px-3 py-1.5 text-left text-sm font-medium transition-colors"
                [ngClass]="isActive(p) ? 'bg-primary text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground'"
                (click)="selectPreset(p)"
              >
                {{ labels[p] }}
              </button>
            }
          </div>
        } @else {
          <div class="flex flex-wrap gap-1.5">
            @for (p of presets; track p) {
              <button
                app-dn-button
                [variant]="isActive(p) ? 'default' : 'outline'"
                size="sm"
                (click)="selectPreset(p)"
              >
                {{ labels[p] }}
              </button>
            }
          </div>
        }

        <app-range-calendar
          [seed]="calendarSeed"
          [monthCount]="monthCount"
          [today]="today"
          (rangeChange)="onCalendarRange($event)"
        ></app-range-calendar>
      </div>

      <!-- Footer: live summary of the staged range, plus discard / commit. -->
      <div class="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
        <span class="text-sm text-muted-foreground">{{ summary }}</span>
        <div class="flex items-center gap-2 shrink-0">
          <button app-dn-button variant="ghost" size="sm" (click)="onCancel()">Cancel</button>
          <button app-dn-button variant="default" size="sm" (click)="onApply()">Apply</button>
        </div>
      </div>
    </div>
  `,
})
export class DateRangePanelComponent implements OnChanges {
  @Input() initial!: ReportDateRange;
  @Input() variant: 'popover' | 'sheet' = 'popover';
  @Input() today = '';
  @Output() applied = new EventEmitter<ReportDateRange>();
  @Output() cancelled = new EventEmitter<void>();

  /** The draft range — never escapes the panel until Apply. */
  staged!: ReportDateRange;
  /** Calendar reset seed — a NEW object only on open + preset clicks. */
  calendarSeed!: { from: string; to: string };

  readonly presets: ReportPreset[] = REPORT_PRESETS.filter((p) => p !== 'custom');
  readonly labels = PRESET_LABELS;

  ngOnChanges(changes: SimpleChanges): void {
    // Seed (or re-seed) the draft from `initial`. Done in ngOnChanges, not
    // ngOnInit, so it works for BOTH mount styles: the declarative sheet (input
    // bound before init) and the desktop ComponentPortal (inputs set post-init).
    if (changes['initial'] && this.initial) {
      this.staged = { ...this.initial };
      this.calendarSeed = { from: this.initial.from, to: this.initial.to };
    }
  }

  get monthCount(): 1 | 2 {
    return this.variant === 'popover' ? 2 : 1;
  }

  get summary(): string {
    return formatRangeSummary(this.staged.from, this.staged.to);
  }

  isActive(p: ReportPreset): boolean {
    return this.staged.preset === p;
  }

  selectPreset(p: ReportPreset): void {
    const now = this.today ? parseISO(this.today) : new Date();
    this.staged = presetToRange(p, now);
    // New object reference so the calendar resets to this preset's range.
    this.calendarSeed = { from: this.staged.from, to: this.staged.to };
  }

  onCalendarRange(range: { from: string; to: string }): void {
    // Fold a calendar pick into a custom range. Deliberately does NOT touch
    // calendarSeed — writing back would reset the calendar mid-selection.
    this.staged = { preset: 'custom', from: range.from, to: range.to };
  }

  onApply(): void {
    this.applied.emit(this.staged);
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
