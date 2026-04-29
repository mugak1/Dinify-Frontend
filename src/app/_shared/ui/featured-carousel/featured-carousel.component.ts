import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-featured-carousel',
  standalone: true,
  imports: [CommonModule],
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
    const price = Number(item.primary_price) || 0;
    const discountAmt = Number(item?.discount_details?.discount_amount) || 0;
    if (!price) return '';
    const pct = Math.round(((price - discountAmt) / price) * 100);
    return pct > 0 ? `-${pct}%` : '';
  }

  onCardTap(item: any): void {
    if (this.isOutOfStock(item)) return;
    this.itemTap.emit(item);
  }
}
