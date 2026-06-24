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
      class="inline-flex items-center justify-center rounded-full font-semibold max-w-full px-[10px] py-[3px] text-[12px] bg-gray-50 text-gray-500 ring-1 ring-inset ring-gray-200"
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
