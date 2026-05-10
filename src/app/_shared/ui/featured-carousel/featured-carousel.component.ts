import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from 'src/environments/environment';
import { getCurrentPrice, getDiscountBadgeText } from 'src/app/_shared/utils/price-utils';
import { getMenuItemCardImagePath } from 'src/app/_shared/utils/image-utils';
import { MenuItem } from 'src/app/_models/app.models';
import { ImageWithSkeletonComponent } from '../image-with-skeleton/image-with-skeleton.component';

@Component({
  selector: 'app-featured-carousel',
  standalone: true,
  imports: [CommonModule, ImageWithSkeletonComponent],
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

  getDiscountBadge(item: any): string {
    if (!item?.running_discount) return '';
    return getDiscountBadgeText(item?.discount_details, Number(item?.primary_price) || 0);
  }

  getDisplayPrice(item: any): number {
    return getCurrentPrice(item as MenuItem);
  }

  getCardImageUrl(item: any): string | null {
    const path = getMenuItemCardImagePath(item);
    return path ? this.imageBaseUrl + path : null;
  }

  getCardImgClass(item: any): string {
    const base = 'w-full h-full object-cover transition-[transform,opacity] duration-300';
    return this.isOutOfStock(item) ? base : `${base} group-hover:scale-105`;
  }

  onCardTap(item: any): void {
    if (this.isOutOfStock(item)) return;
    this.itemTap.emit(item);
  }
}
