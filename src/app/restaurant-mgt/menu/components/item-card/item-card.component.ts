import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MenuItem } from 'src/app/_models/app.models';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { BadgeComponent } from 'src/app/_shared/ui/badge/badge.component';
import { TooltipDirective } from 'src/app/_shared/ui/tooltip/tooltip.directive';
import { SafeArrayPipe } from 'src/app/_shared/ui/safe-array.pipe';
import { TagPillComponent } from 'src/app/_shared/tags/tag-pill.component';
import { PriceDisplayComponent } from 'src/app/_shared/ui/price-display/price-display.component';
import { isDiscountActive, getCurrentPrice, getDiscountBadgeText } from 'src/app/_shared/utils/price-utils';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-item-card',
  standalone: true,
  imports: [CommonModule, SwitchComponent, ButtonComponent, BadgeComponent, TooltipDirective, SafeArrayPipe, TagPillComponent, PriceDisplayComponent],
  templateUrl: './item-card.component.html',
})
export class ItemCardComponent {

  @Input({ required: true }) item!: MenuItem;
  @Input() showDragHandle = false;
  @Input() selectionMode = false;
  @Input() isSelected = false;

  @Output() edit = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
  @Output() toggleAvailability = new EventEmitter<{ id: string; available: boolean }>();
  @Output() toggleStock = new EventEmitter<{ id: string; in_stock: boolean }>();
  @Output() toggleFeatured = new EventEmitter<{ id: string; is_featured: boolean }>();
  @Output() togglePopular = new EventEmitter<{ id: string; is_popular: boolean }>();
  @Output() toggleNew = new EventEmitter<{ id: string; is_new: boolean }>();
  @Output() toggleSelect = new EventEmitter<void>();

  showStockMenu = false;

  constructor(private elRef: ElementRef) {}

  @HostListener('document:click', ['$event.target'])
  onDocumentClick(target: HTMLElement): void {
    if (this.showStockMenu && !this.elRef.nativeElement.contains(target)) {
      this.showStockMenu = false;
    }
  }

  onCardClick(): void {
    if (this.selectionMode) {
      this.toggleSelect.emit();
    } else {
      this.edit.emit();
    }
  }

  onStockButtonClick(event: MouseEvent): void {
    event.stopPropagation();
    this.showStockMenu = !this.showStockMenu;
  }

  setStock(inStock: boolean): void {
    this.showStockMenu = false;
    this.toggleStock.emit({ id: this.item.id, in_stock: inStock });
  }

  get inStock(): boolean {
    return this.item?.in_stock !== false;
  }

  get imageUrl(): string {
    return this.item?.image ? environment.apiUrl + this.item.image : '';
  }

  get hasDiscount(): boolean {
    return isDiscountActive(this.item?.discount_details);
  }

  /** Original (pre-discount) price as a number. `primary_price` is a string Decimal
   *  on the model, so coerce for the numeric app-price-display input. */
  get originalPrice(): number {
    return Number(this.item?.primary_price) || 0;
  }

  /** Live effective price (device-clock discount applied), matching `hasDiscount`. */
  get effectivePrice(): number {
    return getCurrentPrice(this.item);
  }

  /** "-X%" magnitude for the discount badge ('' when no live reduction). */
  get discountBadgeText(): string {
    return getDiscountBadgeText(this.item?.discount_details, this.originalPrice);
  }
}
