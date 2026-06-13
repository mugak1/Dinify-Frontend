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

  get containerClass(): string {
    return cn(
      'text-card-foreground rounded-lg',
      'bg-card border border-gray-200',
      'transition-all duration-200 hover:-translate-y-1',
      this.fullHeight && 'h-full'
    );
  }
}
