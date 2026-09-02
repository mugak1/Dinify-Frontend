import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The empty state for a trend badge with no usable baseline — a neutral grey "New" pill
 * rather than a blank space, so the operator learns *why* the number is absent instead of
 * just finding it missing.
 *
 * Pure and input-free: the host decides *when* to show it, via
 * `percentChange(...) === null` (`_shared/utils/percent-change.ts`).
 *
 * THE no-baseline chip. Both hosts render this one component: the Dashboard badges
 * (`revenue-card`, `total-orders-card`, `trend-indicator`) and the Reports
 * `ReportDeltaChipComponent`. Reports additionally renders NOTHING on a negative baseline
 * rather than this pill — see that component for why.
 *
 * The `aria-label` is the accessibility contract doing the explaining here, since "New"
 * alone does not say what it is new relative to. It is pinned by spec — do not reword it.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-no-baseline-chip',
  standalone: true,
  template: `
    <span
      class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground border border-border whitespace-nowrap"
      aria-label="No prior period to compare"
    >
      New
    </span>
  `,
})
export class NoBaselineChipComponent {}
