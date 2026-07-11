import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from 'src/environments/environment';
import { discountIsLive as discountIsLiveFn, serverEffectivePrice } from 'src/app/_shared/utils/price-utils';
import { PriceDisplayComponent } from '../price-display/price-display.component';
import { DiscountBadgeComponent } from '../discount-badge/discount-badge.component';

@Component({
  selector: 'app-featured-carousel',
  standalone: true,
  imports: [CommonModule, PriceDisplayComponent, DiscountBadgeComponent],
  templateUrl: './featured-carousel.component.html',
})
export class FeaturedCarouselComponent {
  @Input() items: any[] = [];
  @Input() sectionId: string = 'Featured';
  @Input() scrollMarginVar: string = 'var(--menu-nav-stack-height)';

  @Output() itemTap = new EventEmitter<any>();

  imageBaseUrl = environment.apiUrl;

  /** Ids whose photo URL 404'd — falls the tile back to its neutral gray fill
   *  instead of a torn broken-image glyph. */
  private erroredImages = new Set<string>();
  onImageError(id: string): void { this.erroredImages.add(id); }
  imageErrored(item: any): boolean { return !!item?.id && this.erroredImages.has(item.id); }

  isOutOfStock(item: any): boolean {
    return item?.in_stock === false;
  }

  /** Server-truth live-now verdict (is_discount_active) — the same gate the menu
   *  cards + item-detail use, so the carousel can't disagree for the same item. */
  hasDiscount(item: any): boolean {
    return discountIsLiveFn(item);
  }

  /** Discount percentage for the badge — the server-emitted field the cards pass. */
  discountPercent(item: any): number {
    return Number(item?.discount_percentage) || 0;
  }

  /** Server's effective base price (current_price) — matches the menu cards. */
  getDisplayPrice(item: any): number {
    return serverEffectivePrice(item);
  }

  /** primary_price coerced to a number for the struck original. */
  basePrice(item: any): number {
    return Number(item?.primary_price) || 0;
  }

  onCardTap(item: any): void {
    if (this.isOutOfStock(item)) return;
    this.itemTap.emit(item);
  }
}
