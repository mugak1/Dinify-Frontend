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
  @Input() elevated = false;
  @Input() fullHeight = false;
  @Input() glossy = false;

  get containerClass(): string {
    return cn(
      'text-card-foreground rounded-lg',
      'transition-all duration-200 hover:-translate-y-1',
      this.glossy
        ? 'bg-gradient-to-b from-white via-[#FAFCFE] to-[#E7EDF3] border border-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,1),var(--shadow-lg)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),var(--shadow-lg)]'
        : 'bg-card border shadow-[var(--shadow-md)] hover:shadow-[var(--shadow-lg)]',
      this.fullHeight && 'h-full'
    );
  }
}
