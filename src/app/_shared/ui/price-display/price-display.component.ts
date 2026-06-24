import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { cn } from '../../utils/cn';
import { formatUGX } from '../../utils/price-utils';

export type PriceDisplaySize = 'sm' | 'md' | 'lg';

/**
 * Presentational strikethrough-price pair: a bold brand-red effective price with the
 * struck-through grey original beside it. Pure — takes numbers and formats internally via
 * the shared `formatUGX`; no item objects, no discount-gate or fetch logic. The struck
 * original renders only when it genuinely exceeds the effective price, so a non-discounted
 * caller can pass `original = 0` (or an equal value) and get just the price.
 *
 * Covers every diner strikethrough pair (item-detail price, menu card footer, the featured
 * carousel, basket lines) at sizes sm→lg, plus the `+UGX` add-on / extra form via `prefix`.
 */
@Component({
  selector: 'app-price-display',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span [class]="rootClass">
      <span [class]="effectiveClass">{{ render(effective) }}</span>
      <span *ngIf="showOriginal" [class]="originalClass">{{ render(original) }}</span>
    </span>
  `,
})
export class PriceDisplayComponent {
  @Input() original = 0;
  @Input() effective = 0;
  @Input() size: PriceDisplaySize = 'md';
  /** Optional leading glyph, e.g. '+' for add-on / extra prices ("+UGX 500"). */
  @Input() prefix = '';

  /** Strike the original only when there is a genuine reduction to show. */
  get showOriginal(): boolean {
    return this.original > this.effective;
  }

  render(value: number): string {
    return `${this.prefix}${formatUGX(value)}`;
  }

  get rootClass(): string {
    return cn('inline-flex items-baseline', this.size === 'sm' ? 'gap-1' : 'gap-2');
  }

  get effectiveClass(): string {
    return cn(
      'font-bold text-red-600',
      this.size === 'sm' && 'text-sm',
      this.size === 'md' && 'text-base',
      this.size === 'lg' && 'text-2xl',
    );
  }

  get originalClass(): string {
    return cn(
      'line-through text-gray-400',
      this.size === 'sm' && 'text-xs',
      this.size === 'md' && 'text-sm',
      this.size === 'lg' && 'text-base',
    );
  }
}
