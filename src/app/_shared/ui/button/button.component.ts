import { Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};

const sizeClasses: Record<ButtonSize, string> = {
  default: 'px-4 py-2 text-sm',
  sm: 'px-3 py-1.5 text-xs',
  lg: 'px-6 py-3 text-base',
  icon: 'h-9 w-9 p-0',
};

@Component({
  selector: 'dn-button, button[dn-button]',
  standalone: true,
  template: `<ng-content></ng-content>`,
  host: {
    '[class]': 'hostClass',
    '[attr.disabled]': 'disabled || null',
  },
})
export class ButtonComponent {
  @Input() variant: ButtonVariant = 'default';
  @Input() size: ButtonSize = 'default';
  @Input() disabled = false;

  get hostClass(): string {
    return cn(
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      variantClasses[this.variant],
      sizeClasses[this.size],
      this.disabled && 'opacity-50 pointer-events-none'
    );
  }
}
