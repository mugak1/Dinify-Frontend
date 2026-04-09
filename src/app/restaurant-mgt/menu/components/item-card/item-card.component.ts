import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MenuItem } from 'src/app/_models/app.models';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { BadgeComponent } from 'src/app/_shared/ui/badge/badge.component';
import { TooltipDirective } from 'src/app/_shared/ui/tooltip/tooltip.directive';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-item-card',
  standalone: true,
  imports: [CommonModule, SwitchComponent, ButtonComponent, BadgeComponent, TooltipDirective],
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
  @Output() toggleFeatured = new EventEmitter<{ id: string; is_featured: boolean }>();
  @Output() togglePopular = new EventEmitter<{ id: string; is_popular: boolean }>();
  @Output() toggleNew = new EventEmitter<{ id: string; is_new: boolean }>();
  @Output() toggleSelect = new EventEmitter<void>();

  onCardClick(): void {
    if (this.selectionMode) {
      this.toggleSelect.emit();
    } else {
      this.edit.emit();
    }
  }

  get imageUrl(): string {
    return this.item?.image ? environment.apiUrl + this.item.image : '';
  }

  get hasDiscount(): boolean {
    return !!this.item?.discount_details?.discount_amount;
  }
}
