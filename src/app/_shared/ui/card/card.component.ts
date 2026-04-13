import { Component, Input } from '@angular/core';
import { cn } from '../../utils/cn';

@Component({
  selector: 'app-dn-card',
  standalone: true,
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
  @Input() elevated = false;
  @Input() fullHeight = false;

  get containerClass(): string {
    return cn(
      'bg-card text-card-foreground rounded-lg border',
      'shadow-[var(--shadow-md)]',
      'transition-all duration-200 hover:shadow-[var(--shadow-lg)] hover:-translate-y-1',
      this.fullHeight && 'h-full'
    );
  }
}
