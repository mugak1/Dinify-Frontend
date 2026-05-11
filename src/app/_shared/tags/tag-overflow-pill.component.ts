import { Component, Input } from '@angular/core';

/**
 * Neutral "+N" indicator rendered alongside tag pills when a compact
 * card hides non-allergen tags. Visually a sibling of `<app-tag-pill>`
 * but outlined / no icon so a diner can't mistake it for a real tag.
 *
 * Tap behaviour is owned by the surrounding card (which opens the
 * detail modal) — this component is presentation-only.
 */
@Component({
  selector: 'app-tag-overflow-pill',
  standalone: true,
  template: `
    <span
      class="inline-flex items-center rounded-full font-medium max-w-full px-2 py-0.5 text-xs border border-gray-300 text-gray-600 bg-white"
      [attr.aria-label]="ariaLabel"
    >+{{ count }}</span>
  `,
})
export class TagOverflowPillComponent {
  @Input({ required: true }) count = 0;

  get ariaLabel(): string {
    return `${this.count} more tag${this.count === 1 ? '' : 's'}`;
  }
}
