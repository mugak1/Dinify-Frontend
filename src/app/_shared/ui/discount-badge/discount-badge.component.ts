import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { cn } from '../../utils/cn';
import { formatUGX } from '../../utils/price-utils';

export type DiscountBadgeVariant = 'frosted' | 'solid';
export type DiscountBadgeSize = 'sm' | 'md' | 'lg';

/**
 * Presentational "X% off" discount badge, in green. Pure — takes a percentage (and an
 * optional save amount); no item objects, gate or fetch logic.
 *
 *  - `frosted` — the hero treatment from the approved mock: a translucent white
 *    (rgba(255,255,255,0.92)) pill with backdrop-blur, green text and a green sparkle-disc.
 *    The rgba base keeps it legible where `backdrop-filter` is unsupported.
 *  - `solid` — a solid-green chip for small image overlays (featured carousel; wired in PR2).
 *
 * NB the visual input is `variant`, not `style`: `style` collides with the native HTML
 * attribute, which Angular cannot bind a component input through. Greens reuse the steps the
 * tag-pill palette settled on (green-600 / green-700) — no color-mix, no new hexes.
 */
@Component({
  selector: 'app-discount-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span [class]="containerClass">
      <span *ngIf="variant === 'frosted'" [class]="discClass">
        <svg [attr.width]="iconSize" [attr.height]="iconSize" viewBox="0 0 24 24"
             fill="currentColor" aria-hidden="true">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/>
        </svg>
      </span>
      <span>{{ displayPercent }}% off</span>
      <span *ngIf="save != null" class="font-medium opacity-90">· Save {{ formattedSave }}</span>
    </span>
  `,
})
export class DiscountBadgeComponent {
  @Input() percent = 0;
  @Input() variant: DiscountBadgeVariant = 'solid';
  @Input() size: DiscountBadgeSize = 'md';
  /** Optional inline "· Save UGX Y" suffix for compact contexts (menu card; wired in PR2). */
  @Input() save: number | null = null;

  get displayPercent(): number {
    return Math.round(Number(this.percent) || 0);
  }

  get formattedSave(): string {
    return formatUGX(Number(this.save) || 0);
  }

  get containerClass(): string {
    const tone =
      this.variant === 'frosted'
        ? 'bg-[rgba(255,255,255,0.92)] backdrop-blur-md shadow-sm text-green-700'
        : 'bg-green-600 text-white';
    const sizing =
      this.size === 'sm'
        ? 'gap-1 px-1.5 py-0.5 text-micro'
        : this.size === 'lg'
          ? 'gap-2 px-3 py-1.5 text-sm'
          : 'gap-1.5 px-2.5 py-1 text-xs';
    return cn('inline-flex items-center rounded-full font-semibold', tone, sizing);
  }

  get discClass(): string {
    const dim = this.size === 'sm' ? 'w-4 h-4' : this.size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';
    return cn('inline-flex items-center justify-center rounded-full bg-green-600 text-white', dim);
  }

  get iconSize(): number {
    return this.size === 'sm' ? 10 : this.size === 'lg' ? 14 : 12;
  }
}
