import { Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

@Component({
  selector: 'app-dn-card',
  standalone: true,
  host: { class: 'block', '[class.h-full]': 'fullHeight' },
  template: `
    <div [class]="containerClass">
      <ng-content select="[card-header]"></ng-content>
      <ng-content select="[card-title]"></ng-content>
      <ng-content select="[card-description]"></ng-content>
      <ng-content select="[card-content]"></ng-content>
      <ng-content></ng-content>
      <ng-content select="[card-footer]"></ng-content>
    </div>
  `,
})
export class CardComponent {
  @Input() fullHeight = false;
  @Input() square = false;

  get containerClass(): string {
    return cn(
      'text-card-foreground',
      this.square ? 'rounded-none' : 'rounded-lg',
      'bg-card border border-gray-200',
      'transition-all duration-200',
      this.fullHeight && 'h-full'
    );
  }
}
