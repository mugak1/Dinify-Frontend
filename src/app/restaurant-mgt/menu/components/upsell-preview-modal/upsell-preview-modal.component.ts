import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { MenuItem } from 'src/app/_models/app.models';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-upsell-preview-modal',
  standalone: true,
  imports: [CommonModule, DialogComponent, ButtonComponent],
  templateUrl: './upsell-preview-modal.component.html',
})
export class UpsellPreviewModalComponent {

  @Input() open = false;
  @Input() items: MenuItem[] = [];
  @Input() title = '';
  @Output() closed = new EventEmitter<void>();

  getImageUrl(item: MenuItem): string {
    if (!item.image) return '';
    if (item.image.startsWith('http')) return item.image;
    return environment.apiUrl + item.image;
  }

  onClose(): void {
    this.closed.emit();
  }
}
