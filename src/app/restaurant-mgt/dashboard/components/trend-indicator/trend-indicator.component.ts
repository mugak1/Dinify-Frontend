import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-trend-indicator',
  standalone: true,
  template: `
    @if (previous !== 0) {
      <div
        class="inline-flex items-center gap-0.5 sm:gap-1 px-1 sm:px-1.5 py-0.5 rounded-full text-[8px] sm:text-[10px] font-medium border max-w-full"
        [class]="isPositive
          ? 'bg-success/10 text-success border-success/20'
          : 'bg-destructive/10 text-destructive border-destructive/20'"
      >
        @if (isPositive) {
          <!-- TrendingUp arrow -->
          <svg class="w-2 h-2 sm:w-3 sm:h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
            <polyline points="16 7 22 7 22 13"/>
          </svg>
        } @else {
          <!-- TrendingDown arrow -->
          <svg class="w-2 h-2 sm:w-3 sm:h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
    }
  `,
})
export class TrendIndicatorComponent {
  @Input({ required: true }) current!: number;
  @Input({ required: true }) previous!: number;
  @Input() label = 'vs yesterday';

  get changePercent(): number {
    if (this.previous === 0) return 0;
    return ((this.current - this.previous) / this.previous) * 100;
  }

  get isPositive(): boolean {
    return this.changePercent >= 0;
  }

  get displayValue(): string {
    return Math.abs(this.changePercent).toFixed(1);
  }
}
