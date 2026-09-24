import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

/**
 * The subtle "ⓘ Allergens & dietary info" link on the diner item-detail page.
 * It opens `app-allergen-info-sheet`, which the HOST mounts, because the link
 * sits inside the page's content sheet and the pop-up must not (see that
 * component's docstring for why).
 *
 * Shown on EVERY dish. The amber banner it replaced was gated on the dish
 * having tags, so a dish with none (often one sold with modifiers and extras)
 * showed no allergen guidance at all. That is the dish where it matters most,
 * because the diner is about to add things to it.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-allergen-info-link',
  standalone: true,
  template: `
    <button type="button" (click)="openInfo.emit()" aria-haspopup="dialog"
      class="inline-flex items-center gap-1.5 min-h-[44px] rounded-sm text-body font-medium text-gray-700
             underline underline-offset-4 decoration-gray-300 hover:text-gray-900 hover:decoration-gray-500
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class="flex-shrink-0 text-gray-500" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
      </svg>
      Allergens &amp; dietary info
    </button>
  `,
})
export class AllergenInfoLinkComponent {
  /** The diner asked to see the allergen information. */
  @Output() openInfo = new EventEmitter<void>();
}
