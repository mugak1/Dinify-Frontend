// The staged body behind "Custom period" (TIMEFRAME-02D).
//
// A single START date, not a range. The end is derived from the PRIMARY range's length and
// is never editable, which is the whole point: everything downstream — the delta arithmetic,
// 02C's pairing offset, the x-axis — assumes the two windows are equal length. So the panel
// shows the derived window rather than letting the user set it, and the label says "period"
// rather than "range", because a two-ended calendar whose end silently snaps would be a
// control that lies about what it does.
//
// Staged like `DateRangePanelComponent`: a click mutates `staged` only, and nothing leaves
// here until Apply. Cancel leaves the caller's previous basis entirely alone.

import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { ButtonComponent } from '../../ui/button/button.component';
import { ReportDateRange } from '../timeframe-range';
import { maxCustomComparisonStart, resolveComparison } from '../timeframe-engine';
import { RangeCalendarComponent } from './range-calendar.component';
import { formatRangeSummary } from './range-label';

@Component({
  selector: 'app-comparison-start-panel',
  standalone: true,
  imports: [CommonModule, A11yModule, ButtonComponent, RangeCalendarComponent],
  template: `
    <div
      class="bg-popover text-popover-foreground"
      [ngClass]="
        variant === 'popover' ? 'rounded-lg border border-border shadow-lg p-4' : 'flex flex-col p-4'
      "
      [cdkTrapFocus]="variant === 'popover'"
      [cdkTrapFocusAutoCapture]="variant === 'popover'"
      [attr.role]="variant === 'popover' ? 'dialog' : null"
      [attr.aria-modal]="variant === 'popover' ? 'true' : null"
      [attr.aria-label]="variant === 'popover' ? 'Choose the comparison period start' : null"
    >
      <p class="text-sm font-medium text-foreground mb-1">Compare against</p>
      <p class="text-caption text-muted-foreground mb-3">
        Pick the day this period starts. It runs the same length as the range you are viewing.
      </p>

      <app-range-calendar
        mode="single"
        [seed]="calendarSeed"
        [monthCount]="1"
        [today]="today"
        [max]="max"
        (rangeChange)="onPick($event)"
      ></app-range-calendar>

      <!-- The derived window, shown rather than implied: the user picks one end and needs to
           see the other before committing. -->
      <div class="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border">
        <span class="text-sm text-muted-foreground">{{ summary }}</span>
        <div class="flex items-center gap-2 shrink-0">
          <button app-dn-button variant="ghost" size="sm" (click)="onCancel()">Cancel</button>
          <button app-dn-button variant="default" size="sm" [disabled]="!staged" (click)="onApply()">
            Apply
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ComparisonStartPanelComponent implements OnChanges {
  /** The PRIMARY range. Its length is what derives the window's end. */
  @Input() range!: ReportDateRange;
  /** The start to open on, or `null` for a window not yet placed. */
  @Input() initial: string | null = null;
  @Input() variant: 'popover' | 'sheet' = 'popover';
  @Input() today = '';

  @Output() applied = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  /** The draft start — never escapes the panel until Apply. */
  staged: string | null = null;
  /** Calendar reset seed; a NEW object only when `initial`/`range` change. */
  calendarSeed!: { from: string; to: string };
  max = '';

  ngOnChanges(changes: SimpleChanges): void {
    // Seeded in ngOnChanges, not ngOnInit, so it works for BOTH mount styles — the
    // declarative sheet (inputs bound before init) and the desktop ComponentPortal (inputs
    // set after init). Same reasoning as `DateRangePanelComponent`.
    if (changes['initial'] || changes['range']) {
      this.max = maxCustomComparisonStart(this.range);
      // A held start can be past the bound if the range grew since it was placed; opening on
      // a disabled day would be a dead calendar, so fall back to the latest legal day.
      const opening = this.initial && this.initial <= this.max ? this.initial : this.max;
      this.staged = this.initial && this.initial <= this.max ? this.initial : null;
      this.calendarSeed = { from: opening, to: opening };
    }
  }

  onPick(picked: { from: string; to: string }): void {
    // Single mode emits from === to. Deliberately does NOT write back to `calendarSeed` —
    // that would reset the calendar mid-selection (the component's stated contract).
    this.staged = picked.from;
  }

  /** The window Apply would commit — derived here only for DISPLAY, via the one resolver. */
  get summary(): string {
    if (!this.staged) return 'Pick a start day';
    const w = resolveComparison(this.range, 'custom', undefined, this.staged);
    return w ? formatRangeSummary(w.from, w.to) : 'Pick a start day';
  }

  onApply(): void {
    if (this.staged) this.applied.emit(this.staged);
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
