import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';

@Component({
  selector: 'app-bulk-stock-bar',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './bulk-stock-bar.component.html',
})
export class BulkStockBarComponent {
  @Input() selectedCount = 0;
  @Input() totalCount = 0;

  @Output() selectAll = new EventEmitter<void>();
  @Output() clearSelection = new EventEmitter<void>();
  @Output() markAvailable = new EventEmitter<void>();
  @Output() markUnavailable = new EventEmitter<void>();
}
