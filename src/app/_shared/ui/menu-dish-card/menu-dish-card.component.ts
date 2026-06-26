import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MenuItemTagRef } from 'src/app/_models/app.models';
import { PriceDisplayComponent } from '../price-display/price-display.component';
import { DiscountBadgeComponent } from '../discount-badge/discount-badge.component';
import { TagPillComponent } from '../../tags/tag-pill.component';
import { TagOverflowPillComponent } from '../../tags/tag-overflow-pill.component';
import { HighlightPipe } from '../highlight.pipe';

/**
 * Shared diner dish-card — the SINGLE source of truth for the diner menu browse card and
 * the restaurant-portal preview drawer (which must mirror the live diner menu like-for-like).
 *
 * Pure presentational, mirroring the price-trio philosophy: it takes already-computed
 * numbers/booleans and emits one `(cardClick)`. It owns NO item object, NO fetch, and NO
 * discount-gate logic — each host derives the inputs with its own price strategy (the diner
 * menu from server-truth `is_discount_active`/`current_price`; the preview drawer from a
 * device-clock read of `discount_details`) and feeds them in. This is why the discount must
 * arrive pre-resolved as `showDiscount`/`effectivePrice`/`originalPrice`/`discountPercent`/
 * `savings` rather than as an item.
 *
 * Markup is the diner card verbatim (display-font name, kcal+diet-tag meta line, green solid
 * discount badge, 2-line reserved description, brand-red menu-card price, flat 104px photo
 * with the overhanging ringed add affordance). Change the card here and both surfaces follow.
 */
@Component({
  selector: 'app-menu-dish-card',
  standalone: true,
  imports: [
    CommonModule,
    PriceDisplayComponent,
    DiscountBadgeComponent,
    TagPillComponent,
    TagOverflowPillComponent,
    HighlightPipe,
  ],
  templateUrl: './menu-dish-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuDishCardComponent {
  @Input() name = '';
  @Input() description: string | null = null;
  @Input() calories: number | null = null;
  /** Already-resolved full image URL, or null for the no-photo placeholder. */
  @Input() imageUrl: string | null = null;

  /** Effective ("now") price in UGX. In the non-discount case this equals the base price,
   *  so the plain price span renders it directly. */
  @Input() effectivePrice = 0;
  /** Original / pre-discount price; struck beside the effective price only when showDiscount. */
  @Input() originalPrice = 0;
  /** Discount is live AND the item is in stock — gates the green badge + struck price. */
  @Input() showDiscount = false;
  @Input() discountPercent = 0;
  @Input() savings = 0;

  @Input() outOfStock = false;
  @Input() isPopular = false;
  @Input() isNew = false;

  /** Pre-split tags (allergens always kept; non-allergens capped) — host derives via splitTagsForCard. */
  @Input() visibleTags: MenuItemTagRef[] = [];
  @Input() hiddenTagCount = 0;

  /** Active search query — drives name/description highlighting + the "Contains" cue text. */
  @Input() searchQuery = '';
  /** Show the "Contains <query>" cue (description-only search match). */
  @Input() showContainsCue = false;

  /** Tapped — the host opens the item detail. Suppressed when out of stock (the diner
   *  card's `viewItem` guards the same way), so an out-of-stock card is inert. */
  @Output() cardClick = new EventEmitter<void>();

  onCardClick(): void {
    if (this.outOfStock) return;
    this.cardClick.emit();
  }
}
