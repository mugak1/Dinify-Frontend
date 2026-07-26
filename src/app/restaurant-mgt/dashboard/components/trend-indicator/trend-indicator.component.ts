import { Component, Input } from '@angular/core';
import { percentChange } from '../../../../_shared/utils/percent-change';
import { NoBaselineChipComponent } from '../../../../_shared/ui/no-baseline-chip/no-baseline-chip.component';

/**
 * Compact trend pill for the tables-card tiles (seatings per table, avg order value).
 *
 * The baseline test is the shared `percentChange` (`_shared/utils/percent-change.ts`).
 * It used to be an inline `previous !== 0` on the template plus a dead zero-branch in the
 * getter that the template guard made unreachable. The zero case behaves exactly as
 * before — no percentage is claimed — but it now also suppresses on a negative,
 * `null`/`undefined` or non-finite baseline, and renders the shared "New" chip in place
 * of the blank space it used to leave.
 *
 * `label` stays `hidden md:inline`: these pills render at 8px inside a 4-up tile grid,
 * where an always-visible caption overflows. A deliberate divergence from the two
 * headline dashboard cards, which show their caption at every breakpoint.
 */
@Component({
  selector: 'app-trend-indicator',
  standalone: true,
  imports: [NoBaselineChipComponent],
  template: `
    @if (changePercent !== null) {
      <div
        class="inline-flex items-center gap-0.5 sm:gap-1 px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-medium border max-w-full"
        [class]="isPositive
          ? 'bg-success/10 text-success border-success/20'
          : 'bg-destructive/10 text-destructive border-destructive/20'"
      >
        @if (isPositive) {
          <!-- TrendingUp arrow -->
          <svg aria-hidden="true" class="w-2 h-2 sm:w-3 sm:h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
            <polyline points="16 7 22 7 22 13"/>
          </svg>
        } @else {
          <!-- TrendingDown arrow -->
          <svg aria-hidden="true" class="w-2 h-2 sm:w-3 sm:h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/>
            <polyline points="16 17 22 17 22 11"/>
          </svg>
        }
        <span class="tabular-nums whitespace-nowrap">
          {{ isPositive ? '+' : '-' }}{{ displayValue }}%
        </span>
        <span class="text-muted-foreground font-normal hidden md:inline truncate">
          {{ label }}
        </span>
      </div>
    } @else {
      <app-no-baseline-chip></app-no-baseline-chip>
    }
  `,
})
export class TrendIndicatorComponent {
  @Input({ required: true }) current!: number;
  @Input({ required: true }) previous!: number;
  @Input() label = 'vs yesterday';

  /** Signed % change, or `null` when the baseline cannot support one. */
  get changePercent(): number | null {
    return percentChange(this.current, this.previous);
  }

  get isPositive(): boolean {
    const change = this.changePercent;
    return change !== null && change >= 0;
  }

  get displayValue(): string {
    const change = this.changePercent;
    return change === null ? '' : Math.abs(change).toFixed(1);
  }
}
