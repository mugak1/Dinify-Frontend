import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { MenuItemTagRef } from 'src/app/_models/app.models';
import { TagPillComponent } from '../../tags/tag-pill.component';
import { SheetComponent } from '../sheet/sheet.component';

/**
 * The allergen pop-up opened by `app-allergen-info-link`: a bottom sheet with
 * the allergen-safety guidance, then the allergen and dietary tags the
 * restaurant put on this dish.
 *
 * MOUNT IT OUTSIDE ANY STACKING CONTEXT, NEVER BESIDE THE LINK. The sheet is
 * `position: fixed` at `z-50`, which only beats the diner shell's sticky brand
 * strip (`z-40`) in the ROOT stacking context. The item-detail content sheet
 * is `relative z-[2]`, which is its own stacking context, so a sheet rendered
 * inside it paints beneath the brand strip whatever its own z-index says. That
 * is why this is a separate component from the link rather than one component
 * that owns both.
 *
 * IT STATES ONLY WHAT THE RESTAURANT TAGGED, AND AN ABSENT TAG IS NOT A CLAIM.
 * A dish with no allergen tags is one nobody has flagged, not one proven free
 * of allergens. The copy says exactly that and never "allergen-free", the
 * same rule this app applies to every other absent answer. Descriptor tags
 * ("Spicy", "Chef's pick") are left out, because they say nothing about
 * allergens or diet. Extras carry no tags on the public menu read, so the
 * pop-up cannot vouch for them either. For a dish with choices it says the
 * guidance covers the dish on its own.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-allergen-info-sheet',
  standalone: true,
  imports: [SheetComponent, TagPillComponent],
  template: `
    <app-dn-sheet side="bottom" [open]="open" (closed)="closed.emit()">
      <!-- Header: full-width rule, content on the same centred column as the
      item page's own footer, so the sheet reads as part of that page at lg:. -->
      <div class="border-b border-gray-200">
        <div class="relative mx-auto flex w-full max-w-2xl items-center justify-center px-14 pt-5 pb-4">
          <h2 class="text-section-title text-gray-900 text-center">Allergens &amp; dietary info</h2>
          <button type="button" (click)="closed.emit()" aria-label="Close allergen information"
            class="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-11 w-11
                   rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="mx-auto w-full max-w-2xl px-6 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-6">
        <!-- The safety guidance as a NEUTRAL callout: the dish's own tags below
        carry their own colours, and a tinted box beside them competed with
        the pills (amber allergen tags read as part of an amber box). -->
        <div class="rounded-xl bg-gray-50 ring-1 ring-inset ring-gray-200 p-4"
          data-testid="allergen-important-info">
          <p class="flex items-center gap-2 text-body font-semibold text-gray-900">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
              class="flex-shrink-0 text-gray-900" aria-hidden="true">
              <circle cx="12" cy="12" r="10" fill="currentColor"/>
              <path d="M12 16v-4M12 8h.01" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
            </svg>
            Important information
          </p>
          <ul class="mt-2 list-disc pl-5 space-y-1.5 text-body text-gray-700 marker:text-gray-400">
            <li>Food allergies? Please ask restaurant staff to confirm before ordering.</li>
            <li>Menu tags are added by the restaurant. They may be incomplete and do not guarantee allergen safety.</li>
            @if (hasChoices) {
              <li data-testid="allergen-choices-note">
                This covers the dish on its own. The options and extras you choose may contain other allergens.
              </li>
            }
          </ul>
        </div>

        <section data-testid="allergen-tags">
          <h3 class="text-micro font-semibold uppercase tracking-wide text-gray-500 mb-3">Allergens</h3>
          @if (allergenTags.length > 0) {
            <div class="flex flex-wrap gap-2">
              @for (tag of allergenTags; track $index) {
                <app-tag-pill [name]="tag.name" [icon]="tag.icon" [colour]="tag.colour" size="md"></app-tag-pill>
              }
            </div>
          } @else {
            <p class="text-body text-gray-600" data-testid="allergen-none-flagged">
              The restaurant hasn't flagged any allergens for this dish. That doesn't mean it's free of them.
            </p>
          }
        </section>

        @if (dietaryTags.length > 0) {
          <section data-testid="dietary-tags">
            <h3 class="text-micro font-semibold uppercase tracking-wide text-gray-500 mb-3">Dietary</h3>
            <div class="flex flex-wrap gap-2">
              @for (tag of dietaryTags; track $index) {
                <app-tag-pill [name]="tag.name" [icon]="tag.icon" [colour]="tag.colour" size="md"></app-tag-pill>
              }
            </div>
          </section>
        }
      </div>
    </app-dn-sheet>
  `,
})
export class AllergenInfoSheetComponent {
  @Input() open = false;
  /** The dish's own tags, already normalised (see `getVisibleTags`). */
  @Input() tags: readonly MenuItemTagRef[] = [];
  /** The dish has modifier groups or extras, so the diner can change it. */
  @Input() hasChoices = false;
  /** Fired by the close button, the backdrop and Escape alike. */
  @Output() closed = new EventEmitter<void>();

  get allergenTags(): readonly MenuItemTagRef[] {
    return this.tags.filter((t) => t.category === 'allergen');
  }

  get dietaryTags(): readonly MenuItemTagRef[] {
    return this.tags.filter((t) => t.category === 'dietary');
  }
}
