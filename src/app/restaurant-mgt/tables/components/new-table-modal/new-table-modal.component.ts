import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { SwitchComponent } from '../../../../_shared/ui/switch/switch.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import {
  DiningArea,
  RestaurantTable,
  TableShape,
  QRMode,
} from '../../models/tables.models';

export const SHAPE_OPTIONS: { value: TableShape; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'bar', label: 'Bar' },
];

export const TAG_OPTIONS = [
  'Window',
  'Booth',
  'High chair friendly',
  'Accessible',
  'VIP',
  'Quiet',
];

@Component({
  selector: 'app-new-table-modal',
  standalone: true,
  imports: [
    FormsModule,
    DialogComponent,
    ButtonComponent,
    SwitchComponent,
    BadgeComponent
],
  templateUrl: './new-table-modal.component.html',
})
export class NewTableModalComponent implements OnChanges {
  @Input() open = false;
  @Input() table: RestaurantTable | null = null;
  @Input() areas: DiningArea[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Partial<RestaurantTable>>();

  shapeOptions = SHAPE_OPTIONS;
  tagOptions = TAG_OPTIONS;

  number = 1;
  displayName = '';
  minCapacity = 2;
  maxCapacity = 4;
  shape: TableShape = 'square';
  areaId = '';
  tags: string[] = [];
  isActive = true;
  generateQR = true;
  qrMode: QRMode = 'order_pay';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      if (this.table) {
        this.number = this.table.number;
        this.displayName = this.table.displayName ?? '';
        this.minCapacity = this.table.minCapacity;
        this.maxCapacity = this.table.maxCapacity;
        this.shape = this.table.shape;
        this.areaId = this.table.areaId ?? '';
        this.tags = [...this.table.tags];
        this.isActive = this.table.isActive;
        this.generateQR = this.table.hasQR;
        this.qrMode = this.table.qrMode ?? 'order_pay';
      } else {
        this.resetForm();
      }
    }
  }

  toggleTag(tag: string): void {
    if (this.tags.includes(tag)) {
      this.tags = this.tags.filter(t => t !== tag);
    } else {
      this.tags = [...this.tags, tag];
    }
  }

  onSubmit(): void {
    if (!this.number || !this.maxCapacity) return;
    const base: Partial<RestaurantTable> = {
      number: this.number,
      displayName: this.displayName.trim() || undefined,
      minCapacity: this.minCapacity,
      maxCapacity: this.maxCapacity,
      shape: this.shape,
      areaId: this.areaId || undefined,
      tags: this.tags,
      isActive: this.isActive,
    };
    if (this.table) {
      // EDIT: never re-send has_qr (a loaded value is not a QR change) and never
      // a client rotation timestamp — the generic editor must not masquerade as
      // QR activation or revocation. QR generation/rotation is a deliberate
      // action from the table row or the QR preview. qr_mode stays an ordinary
      // setting, editable only for a table that already has a QR.
      this.saved.emit({
        ...base,
        qrMode: this.table.hasQR ? this.qrMode : undefined,
      });
    } else {
      // CREATE: the "Generate QR code on save" toggle honestly activates an
      // initial QR (has_qr). No client timestamp — the credential is server-minted.
      this.saved.emit({
        ...base,
        hasQR: this.generateQR,
        qrMode: this.generateQR ? this.qrMode : undefined,
      });
    }
  }

  onClose(): void {
    this.closed.emit();
  }

  private resetForm(): void {
    this.number = 1;
    this.displayName = '';
    this.minCapacity = 2;
    this.maxCapacity = 4;
    this.shape = 'square';
    this.areaId = '';
    this.tags = [];
    this.isActive = true;
    this.generateQR = true;
    this.qrMode = 'order_pay';
  }
}
