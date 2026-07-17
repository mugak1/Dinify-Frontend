import { Component, Input, Output, EventEmitter } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import {
  TableFilters,
  TableStatus,
  DiningArea,
  Server,
} from '../../models/tables.models';

export interface ServiceMetrics {
  inUse: number;
  total: number;
  guestsSeated: number;
  avgTableTime: number;
}

const STATUS_OPTIONS: { value: TableStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'seated', label: 'Seated' },
  { value: 'bill_requested', label: 'Bill requested' },
  { value: 'dirty', label: 'Dirty' },
  { value: 'out_of_service', label: 'Out of service' },
];

const TABLE_SIZE_OPTIONS = [2, 4, 6];

@Component({
  selector: 'app-service-toolbar',
  standalone: true,
  imports: [FormsModule, BadgeComponent],
  templateUrl: './service-toolbar.component.html',
})
export class ServiceToolbarComponent {
  @Input() filters: TableFilters = {
    area: 'all',
    status: [],
    servers: [],
    tableSize: [],
    search: '',
  };
  @Input() areas: DiningArea[] = [];
  @Input() servers: Server[] = [];
  @Input() metrics: ServiceMetrics = {
    inUse: 0,
    total: 0,
    guestsSeated: 0,
    avgTableTime: 0,
  };
  @Output() filtersChange = new EventEmitter<TableFilters>();

  statusOptions = STATUS_OPTIONS;
  tableSizeOptions = TABLE_SIZE_OPTIONS;

  // Dropdown visibility
  showStatusDropdown = false;
  showServerDropdown = false;
  showSizeDropdown = false;

  get activeAreas(): DiningArea[] {
    return this.areas.filter(a => a.isActive);
  }

  selectArea(areaId: string): void {
    this.filtersChange.emit({ ...this.filters, area: areaId });
  }

  updateSearch(search: string): void {
    this.filtersChange.emit({ ...this.filters, search });
  }

  toggleStatus(status: TableStatus): void {
    const current = this.filters.status;
    const updated = current.includes(status)
      ? current.filter(s => s !== status)
      : [...current, status];
    this.filtersChange.emit({ ...this.filters, status: updated });
  }

  toggleServer(serverId: string): void {
    const current = this.filters.servers;
    const updated = current.includes(serverId)
      ? current.filter(s => s !== serverId)
      : [...current, serverId];
    this.filtersChange.emit({ ...this.filters, servers: updated });
  }

  toggleSize(size: number): void {
    const current = this.filters.tableSize;
    const updated = current.includes(size)
      ? current.filter(s => s !== size)
      : [...current, size];
    this.filtersChange.emit({ ...this.filters, tableSize: updated });
  }

  closeDropdowns(): void {
    this.showStatusDropdown = false;
    this.showServerDropdown = false;
    this.showSizeDropdown = false;
  }
}
