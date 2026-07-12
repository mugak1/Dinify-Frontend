import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { TagPillComponent } from 'src/app/_shared/tags/tag-pill.component';
import { RestaurantTag } from 'src/app/_models/app.models';

@Component({
  selector: 'app-preset-tag-delete-dialog',
  standalone: true,
  imports: [CommonModule, DialogComponent, TagPillComponent, ButtonComponent],
  templateUrl: './preset-tag-delete-dialog.component.html',
})
export class PresetTagDeleteDialogComponent {
  @Input() open = false;
  @Input() tag: RestaurantTag | null = null;
  @Input() usageCount = 0;

  @Output() cancelled = new EventEmitter<void>();
  @Output() confirmed = new EventEmitter<void>();

  get isAllergen(): boolean {
    return this.tag?.category === 'allergen';
  }

  get isUnused(): boolean {
    return this.usageCount === 0;
  }

  get isAllergenInUse(): boolean {
    return this.isAllergen && this.usageCount > 0;
  }

  get title(): string {
    if (!this.tag) return 'Delete tag?';
    if (this.isAllergenInUse) {
      return `Delete '${this.tag.name}' allergen warning?`;
    }
    return `Delete '${this.tag.name}'?`;
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  onConfirm(): void {
    this.confirmed.emit();
  }
}
