import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { SwitchComponent } from '../../../../_shared/ui/switch/switch.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { DiningArea, RestaurantTable } from '../../models/tables.models';

@Component({
  selector: 'app-new-area-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogComponent,
    ButtonComponent,
    SwitchComponent,
    BadgeComponent,
  ],
  templateUrl: './new-area-modal.component.html',
})
export class NewAreaModalComponent implements OnChanges {
  @Input() open = false;
  @Input() area: DiningArea | null = null;
  @Input() tables: RestaurantTable[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<DiningArea, 'id'>>();

  name = '';
  description = '';
  isIndoor = true;
  smokingAllowed = false;
  accessible = false;
  defaultServerSection = '';
  selectedTableIds: string[] = [];
  isActive = true;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      if (this.area) {
        this.name = this.area.name;
        this.description = this.area.description ?? '';
        this.isIndoor = this.area.isIndoor;
        this.smokingAllowed = this.area.smokingAllowed;
        this.accessible = this.area.accessible;
        this.defaultServerSection = this.area.defaultServerSection ?? '';
        this.selectedTableIds = [...this.area.tableIds];
        this.isActive = this.area.isActive;
      } else {
        this.resetForm();
      }
    }
  }

  get availableTables(): RestaurantTable[] {
    return this.tables.filter(
      t => !t.areaId || this.selectedTableIds.includes(t.id),
    );
  }

  addTable(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const id = select.value;
    if (id && !this.selectedTableIds.includes(id)) {
      this.selectedTableIds = [...this.selectedTableIds, id];
    }
    select.value = '';
  }

  removeTable(id: string): void {
    this.selectedTableIds = this.selectedTableIds.filter(tid => tid !== id);
  }

  getTableLabel(id: string): string {
    const table = this.tables.find(t => t.id === id);
    if (!table) return id;
    return `T${table.number}${table.displayName ? ' - ' + table.displayName : ''}`;
  }

  onSubmit(): void {
    if (!this.name.trim()) return;
    this.saved.emit({
      name: this.name.trim(),
      description: this.description.trim() || undefined,
      isIndoor: this.isIndoor,
      smokingAllowed: this.smokingAllowed,
      accessible: this.accessible,
      defaultServerSection: this.defaultServerSection.trim() || undefined,
      isActive: this.isActive,
      tableIds: this.selectedTableIds,
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  private resetForm(): void {
    this.name = '';
    this.description = '';
    this.isIndoor = true;
    this.smokingAllowed = false;
    this.accessible = false;
    this.defaultServerSection = '';
    this.selectedTableIds = [];
    this.isActive = true;
  }
}
