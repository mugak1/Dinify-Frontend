import { Component, Input } from '@angular/core';

import { cn } from '../../utils/cn';
import { formatUGX } from '../../utils/price-utils';

export type PriceDisplaySize = 'sm' | 'md' | 'lg' | 'menu-card';
export type PriceDisplayTone = 'accent' | 'neutral';

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
  imports: [],
  template: `
    <span [class]="rootClass">
      <span [class]="effectiveClass">{{ render(effective) }}</span>
      @if (showOriginal) {
        <span [class]="originalClass">{{ render(original) }}</span>
      }
    </span>
    `,
})
export class PriceDisplayComponent {
  @Input() original = 0;
  @Input() effective = 0;
  @Input() size: PriceDisplaySize = 'md';
  /** Colour of the effective price: 'accent' (default) = brand red; 'neutral' = near-black,
   *  for surfaces that shouldn't shout (e.g. the basket item rows). The struck original
   *  stays grey regardless of tone. */
  @Input() tone: PriceDisplayTone = 'accent';
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
    if (this.size === 'menu-card') return cn('inline-flex items-baseline gap-[8px]');
    return cn('inline-flex items-baseline', this.size === 'sm' ? 'gap-1' : 'gap-2');
  }

  get effectiveClass(): string {
    // tone controls ONLY the colour; size still owns the type scale. Default 'accent' keeps
    // the brand red everywhere it renders today (menu card, item-detail, and the basket
    // unit price unless a caller opts into 'neutral').
    const colour = this.tone === 'neutral' ? 'text-gray-900' : 'text-d-red';
    // menu-card: the diner dish-card "now price" — display face, heavier, larger.
    if (this.size === 'menu-card') return cn('font-display font-extrabold text-dish-title', colour);
    return cn(
      'font-bold',
      colour,
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
      this.size === 'menu-card' && 'text-body',
    );
  }
}
