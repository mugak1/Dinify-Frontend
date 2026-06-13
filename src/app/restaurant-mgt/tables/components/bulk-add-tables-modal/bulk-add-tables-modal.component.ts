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
import { DiningArea, TableShape, QRMode } from '../../models/tables.models';
import { SHAPE_OPTIONS } from '../new-table-modal/new-table-modal.component';
import {
  BulkNumberPlan,
  computeBulkTableNumbers,
} from '../../utils/bulk-table-numbers';

/** What the modal emits on submit — the raw range + shared defaults. */
export interface BulkTablesConfig {
  areaId?: string;
  start: number;
  count: number;
  minCapacity: number;
  maxCapacity: number;
  shape: TableShape;
  generateQR: boolean;
  qrMode: QRMode;
}

const MAX_COUNT = 100;

@Component({
  selector: 'app-bulk-add-tables-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogComponent, ButtonComponent],
  templateUrl: './bulk-add-tables-modal.component.html',
})
export class BulkAddTablesModalComponent implements OnChanges {
  @Input() open = false;
  @Input() areas: DiningArea[] = [];
  /** Numbers already used by loaded tables — drives the smart default + preview. */
  @Input() existingNumbers: number[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<BulkTablesConfig>();

  shapeOptions = SHAPE_OPTIONS;
  readonly maxCount = MAX_COUNT;

  areaId = '';
  start = 1;
  count = 10;
  minCapacity = 2;
  maxCapacity = 4;
  shape: TableShape = 'square';
  generateQR = true;
  qrMode: QRMode = 'order_pay';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.resetForm();
    }
  }

  /** Live split of the requested range into create-able vs already-existing. */
  get preview(): BulkNumberPlan {
    return computeBulkTableNumbers(this.start, this.count, this.existingNumbers);
  }

  get canSubmit(): boolean {
    return (
      Number.isInteger(this.start) &&
      this.start >= 1 &&
      Number.isInteger(this.count) &&
      this.count >= 1 &&
      this.count <= MAX_COUNT &&
      this.preview.toCreate.length > 0
    );
  }

  onSubmit(): void {
    if (!this.canSubmit) return;
    this.saved.emit({
      areaId: this.areaId || undefined,
      start: this.start,
      count: this.count,
      minCapacity: this.minCapacity,
      maxCapacity: this.maxCapacity,
      shape: this.shape,
      generateQR: this.generateQR,
      qrMode: this.qrMode,
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  private resetForm(): void {
    this.areaId = '';
    // Smart default: start just past the highest existing number so a fresh
    // range tends not to collide. Explicit length check — Math.max(...[]) is
    // -Infinity (truthy), so a `|| 1` fallback would silently slip through.
    this.start = this.existingNumbers.length
      ? Math.max(...this.existingNumbers) + 1
      : 1;
    this.count = 10;
    this.minCapacity = 2;
    this.maxCapacity = 4;
    this.shape = 'square';
    this.generateQR = true;
    this.qrMode = 'order_pay';
  }
}
