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
          class="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 ring-1 ring-inset ring-green-200 px-2 py-0.5 text-xs font-semibold">
      {{ resolvedLabel }} {{ formattedAmount }}
    </span>

    <div *ngIf="variant === 'banner'"
         class="bg-green-600 text-white rounded-xl p-4 flex items-center gap-3.5">
      <div class="flex-shrink-0 w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <span class="text-[11px] uppercase tracking-widest font-medium text-white/85">{{ resolvedLabel }}</span>
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
