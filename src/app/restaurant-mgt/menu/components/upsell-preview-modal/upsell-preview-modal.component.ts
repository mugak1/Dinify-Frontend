import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { UpsellItem } from 'src/app/_models/app.models';
import { environment } from 'src/environments/environment';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-upsell-preview-modal',
  standalone: true,
  imports: [CommonModule, DialogComponent, ButtonComponent],
  templateUrl: './upsell-preview-modal.component.html',
})
export class UpsellPreviewModalComponent {

  @Input() open = false;
  @Input() items: UpsellItem[] = [];
  @Input() title = '';
  @Output() closed = new EventEmitter<void>();

  getImageUrl(item: UpsellItem): string {
    if (!item.item_image) return '';
    if (item.item_image.startsWith('http')) return item.item_image;
    return environment.apiUrl + item.item_image;
  }

  onClose(): void {
    this.closed.emit();
  }
}
