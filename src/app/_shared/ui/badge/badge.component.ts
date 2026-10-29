import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

// Badges are labels and statuses, never actions, so none of them is brand red:
// default = a chosen/neutral-strong label (ink), success = open/done (green tint),
// warning = waiting (amber tint), destructive = a real problem.
const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-selected text-selected-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  outline: 'border border-input text-foreground bg-transparent',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-900',
};

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-dn-badge',
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
