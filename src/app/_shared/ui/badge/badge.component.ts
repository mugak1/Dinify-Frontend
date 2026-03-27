import { Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border border-input text-foreground bg-transparent',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
};

@Component({
  selector: 'dn-badge',
  standalone: true,
  template: `<ng-content></ng-content>`,
  host: {
    '[class]': 'hostClass',
  },
})
export class BadgeComponent {
  @Input() variant: BadgeVariant = 'default';

  get hostClass(): string {
    return cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
      variantClasses[this.variant]
    );
  }
}
