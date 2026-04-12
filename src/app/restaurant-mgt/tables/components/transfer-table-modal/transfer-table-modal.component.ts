import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { RestaurantTable, DiningArea, SeatedParty } from '../../models/tables.models';

@Component({
  selector: 'app-transfer-table-modal',
  standalone: true,
  imports: [CommonModule, DialogComponent, ButtonComponent, BadgeComponent],
  templateUrl: './transfer-table-modal.component.html',
})
export class TransferTableModalComponent implements OnChanges {
  @Input() open = false;
  @Input() sourceTable: RestaurantTable | null = null;
  @Input() party: SeatedParty | null = null;
  @Input() tables: RestaurantTable[] = [];
  @Input() areas: DiningArea[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() transferred = new EventEmitter<{ sourceTableId: string; destinationTableId: string }>();

  selectedDestination: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && !this.open) {
      this.selectedDestination = null;
    }
  }

  get availableTables(): RestaurantTable[] {
    if (!this.sourceTable) return [];
    return this.tables.filter(
      t => t.id !== this.sourceTable!.id && t.status === 'available' && t.isActive,
    );
  }

  get sourceTableName(): string {
    if (!this.sourceTable) return '';
    return this.sourceTable.displayName || String(this.sourceTable.number);
  }

  get sourceAreaName(): string {
    return this.getArea(this.sourceTable?.areaId)?.name ?? '';
  }

  get orderItemCount(): number {
    return this.party?.orderItems?.length ?? 0;
  }

  getArea(areaId?: string): DiningArea | undefined {
    return areaId ? this.areas.find(a => a.id === areaId) : undefined;
  }

  tableName(t: RestaurantTable): string {
    return t.displayName || String(t.number);
  }

  fits(t: RestaurantTable): boolean {
    return this.party ? t.maxCapacity >= this.party.partySize : true;
  }

  selectDestination(id: string): void {
    this.selectedDestination = id;
  }

  rowClass(t: RestaurantTable): string {
    const base = 'w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors';
    return this.selectedDestination === t.id
      ? `${base} border-primary bg-primary/5`
      : `${base} border-border hover:border-primary/40`;
  }

  handleTransfer(): void {
    if (!this.selectedDestination || !this.sourceTable) return;
    this.transferred.emit({
      sourceTableId: this.sourceTable.id,
      destinationTableId: this.selectedDestination,
    });
    this.selectedDestination = null;
    this.closed.emit();
  }

  handleClose(): void {
    this.selectedDestination = null;
    this.closed.emit();
  }
}
