import { Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link' | 'cta';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
  // The diner primary-CTA look. Brand red (= bg-primary = #FF2C32 post-PR1) with NO
  // colour-hover — the hover is the glow escalation carried in the cta shape below,
  // so this reproduces the hand-rolled bg-d-red CTAs exactly. Its size/shape are
  // fixed (px-4 py-3.5, rounded-xl, glow); the `size` input is ignored for cta.
  cta: 'bg-primary text-primary-foreground',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1.5 text-xs',
  lg: 'px-6 py-3 text-base',
  icon: 'h-9 w-9 p-0',
};

@Component({
  selector: 'app-dn-button, button[app-dn-button]',
  standalone: true,
  // Loading shows a leading spinner and keeps the projected label; the host is
  // disabled + aria-busy while loading (see host bindings below).
  template: `@if (loading) {
      <svg
        class="animate-spin h-4 w-4 mr-2 -ml-1 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg>
    }<ng-content></ng-content>`,
  host: {
    '[class]': 'hostClass',
    '[attr.disabled]': '(disabled || loading) || null',
    '[attr.aria-busy]': 'loading || null',
  },
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'default';
  @Input() size: ButtonSize = 'default';
  @Input() disabled = false;
  @Input() loading = false;

  get hostClass(): string {
    // cn() is a naive join (no tailwind-merge), so radius/font/transition are set on
    // exactly ONE mutually-exclusive branch here — never appended-then-overridden.
    const isCta = this.variant === 'cta';
    return cn(
      'inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      isCta
        ? 'rounded-xl font-semibold gap-2 shadow-glow desktop-hover:shadow-glow-lg motion-safe:active:scale-[0.99] transition-[box-shadow,transform] duration-200'
        : 'rounded-md font-medium transition-colors',
      variantClasses[this.variant],
      isCta ? 'px-4 py-3.5 text-base' : sizeClasses[this.size],
      (this.disabled || this.loading) && 'opacity-60 pointer-events-none cursor-not-allowed'
    );
  }
}
