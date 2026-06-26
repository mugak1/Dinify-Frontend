import { Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

export type AvatarSize = 'sm' | 'md' | 'lg';
export type AvatarVariant = 'default' | 'brand';

// Explicit-px sizes (the app sets html{font-size:14px}, so rem-based heights drift —
// mirror the SectionPageComponent h-[64px] convention for layout-critical sizing).
const sizeClasses: Record<AvatarSize, string> = {
  sm: 'h-[32px] w-[32px] text-[12px]',
  md: 'h-[40px] w-[40px] text-[14px]',
  lg: 'h-[56px] w-[56px] text-[20px]',
};

@Component({
  selector: 'app-dn-avatar',
  standalone: true,
  template: `{{ initials }}`,
  host: {
    '[class]': 'hostClass',
    '[attr.aria-hidden]': 'true',
  },
})
export class AvatarComponent {
  /** Full name; initials are derived from the first and last word. Blank renders an empty circle. */
  @Input() name = '';
  @Input() size: AvatarSize = 'md';
  /** Circle palette: 'default' = neutral grey; 'brand' = brand red with white initials. */
  @Input() variant: AvatarVariant = 'default';

  get initials(): string {
    const parts = this.name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
    return (first + last).toUpperCase();
  }

  get hostClass(): string {
    const palette = this.variant === 'brand'
      ? 'bg-primary text-primary-foreground'
      : 'bg-secondary text-secondary-foreground';
    return cn(
      'inline-flex items-center justify-center rounded-full font-medium shrink-0 select-none leading-none',
      palette,
      sizeClasses[this.size]
    );
  }
}
