import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from 'src/environments/environment';
import { getCurrentPrice, getDiscountPercent } from 'src/app/_shared/utils/price-utils';
import { MenuItem } from 'src/app/_models/app.models';
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

  isOutOfStock(item: any): boolean {
    return item?.in_stock === false;
  }

  hasDiscount(item: any): boolean {
    return !!item?.running_discount;
  }

  /** Numeric discount percentage for the badge (device-clock source unchanged). */
  discountPercent(item: any): number {
    return getDiscountPercent(item?.discount_details, Number(item?.primary_price) || 0);
  }

  getDisplayPrice(item: any): number {
    return getCurrentPrice(item as MenuItem);
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
