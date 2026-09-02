import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { NoBaselineChipComponent } from '../../../../_shared/ui/no-baseline-chip/no-baseline-chip.component';
import { percentChange } from '../../../../_shared/utils/percent-change';

/**
 * Period-over-period change pill (▲/▼ N.N%) — the uniform "compare" treatment for
 * headline numbers across the Reports redesign (hero + KPI rail; reused by C–E).
 * Mirrors the dashboard TrendIndicator visual, with `invert` for metrics where a
 * DECREASE is the good outcome (e.g. discounts / refunds).
 *
 * THREE STATES, because `percentChange` returns `null` for two different reasons and they
 * do not deserve the same answer:
 *
 *   a number                → the delta chip
 *   null, baseline empty    → the shared "New" pill (`app-no-baseline-chip`)
 *   null, baseline NEGATIVE → nothing at all
 *
 * "New" is a positive claim that there is no history to compare against. That is true of a
 * zero, absent or non-finite baseline and FALSE of a negative one, where the restaurant
 * traded and the period netted below zero — so the negative case says nothing rather than
 * something wrong. `baselineIsNegative` below asks only WHY the percentage is null; WHETHER
 * it is stays in `percentChange`, which is the one baseline predicate in the app.
 *
 * Two cases tightened by delegating, both unreachable from the 14 call sites (they all feed
 * real numbers or `?? 0`): a non-finite `current` now falls to "New" rather than rendering
 * `NaN%`, and a `null` `previous` falls to "New" rather than `-Infinity%` — the old local
 * predicate used the coercing global `isFinite`, which admits `null`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  selector: 'app-report-delta-chip',
  standalone: true,
  imports: [NoBaselineChipComponent],
  template: `
    @if (compareEnabled) {
      @if (changePercent !== null) {
        <span
          class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium border tabular-nums whitespace-nowrap"
          [class]="
            positive
              ? 'bg-success/10 text-success border-success/20'
              : 'bg-destructive/10 text-destructive border-destructive/20'
          "
          [attr.aria-label]="ariaLabel"
        >
          <span aria-hidden="true">{{ up ? '▲' : '▼' }}</span>
          {{ magnitude }}%
          @if (label) {
            <span class="text-muted-foreground font-normal hidden md:inline">{{ label }}</span>
          }
        </span>
      } @else if (!baselineIsNegative) {
        <app-no-baseline-chip></app-no-baseline-chip>
      }
    }
  `,
})
export class ReportDeltaChipComponent {
  @Input() current = 0;
  @Input() previous = 0;
  /** When true, a DECREASE is the good (green) outcome — e.g. discounts / refunds. */
  @Input() invert = false;
  /** Optional trailing caption, e.g. 'vs last week'. */
  @Input() label = '';
  /** When false, the chip renders nothing — the shell's "Compare" toggle is off. */
  @Input() compareEnabled = true;

  /** The one baseline predicate in the app — see `_shared/utils/percent-change.ts`. */
  get changePercent(): number | null {
    return percentChange(this.current, this.previous);
  }
  /**
   * WHY `changePercent` is null, not WHETHER — this is what splits the "New" pill from
   * rendering nothing. Deliberately not a second answer to "is there a baseline".
   */
  get baselineIsNegative(): boolean {
    return Number.isFinite(this.previous) && this.previous < 0;
  }
  /** Only read from the chip branch, where `changePercent` is non-null by construction. */
  get pct(): number {
    return this.changePercent ?? 0;
  }
  /** Arrow direction follows the raw sign (up = increase), regardless of good/bad. */
  get up(): boolean {
    return this.pct >= 0;
  }
  /** Colour reads good (green) / bad (red); flips with `invert`. */
  get positive(): boolean {
    return this.invert ? this.pct < 0 : this.pct >= 0;
  }
  get magnitude(): string {
    return Math.abs(this.pct).toFixed(1);
  }
  get ariaLabel(): string {
    return `${this.up ? 'Up' : 'Down'} ${this.magnitude}%${this.label ? ' ' + this.label : ''}`;
  }
}
