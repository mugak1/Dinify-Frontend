import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Period-over-period change pill (▲/▼ N.N%) — the uniform "compare" treatment for
 * headline numbers across the Reports redesign (hero + KPI rail; reused by C–E).
 * Mirrors the dashboard TrendIndicator visual but is a standalone reports primitive
 * with two additions: a "New" state when there is no baseline, and `invert` for
 * metrics where a DECREASE is the good outcome (e.g. discounts / refunds).
 */
@Component({
  selector: 'app-report-delta-chip',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (compareEnabled) {
      @if (hasBaseline) {
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
      } @else {
        <span
          class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground border border-border whitespace-nowrap"
          aria-label="No prior period to compare"
        >
          New
        </span>
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

  get hasBaseline(): boolean {
    return isFinite(this.previous) && this.previous !== 0;
  }
  get pct(): number {
    return this.hasBaseline ? ((this.current - this.previous) / this.previous) * 100 : 0;
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
