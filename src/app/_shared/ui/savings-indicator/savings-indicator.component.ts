import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatUGX } from '../../utils/price-utils';

export type SavingsIndicatorVariant = 'pill' | 'banner';

/**
 * Presentational green savings indicator. Pure — takes an amount and formats internally via
 * the shared `formatUGX`; no item objects, gate or fetch logic.
 *
 *  - `pill` — a slim inline "Save UGX X" chip (item-detail, beside the price).
 *  - `banner` — an aggregate "Total savings UGX Y" card (basket; wired in PR2).
 *
 * `label` overrides the leading text (defaults: "Save" for the pill, "Total savings" for the
 * banner). Greens reuse the tag-pill palette steps (green-50 / green-200 / green-600 / green-700).
 */
@Component({
  selector: 'app-savings-indicator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span *ngIf="variant === 'pill'"
          class="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 ring-1 ring-inset ring-green-200 pl-1 pr-2 py-0.5 text-xs font-semibold">
      <span class="inline-flex items-center justify-center rounded-full bg-green-600 text-white w-4 h-4 flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>
        </svg>
      </span>
      {{ resolvedLabel }} {{ formattedAmount }}
    </span>

    <div *ngIf="variant === 'banner'"
         class="bg-green-600 text-white rounded-xl p-4 flex items-center gap-3.5">
      <div class="flex-shrink-0 w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <span class="text-micro uppercase tracking-widest font-medium text-white/85">{{ resolvedLabel }}</span>
        <span class="text-[22px] font-bold leading-tight tabular-nums">{{ formattedAmount }}</span>
      </div>
    </div>
  `,
})
export class SavingsIndicatorComponent {
  @Input() amount = 0;
  @Input() variant: SavingsIndicatorVariant = 'pill';
  @Input() label = '';

  get resolvedLabel(): string {
    if (this.label) return this.label;
    return this.variant === 'banner' ? 'Total savings' : 'Save';
  }

  get formattedAmount(): string {
    return formatUGX(Number(this.amount) || 0);
  }
}
