import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { DiningArea, Reservation } from '../../models/tables.models';

@Component({
  selector: 'app-new-reservation-modal',
  standalone: true,
  imports: [FormsModule, DialogComponent, ButtonComponent],
  templateUrl: './new-reservation-modal.component.html',
})
export class NewReservationModalComponent implements OnChanges {
  @Input() open = false;
  @Input() areas: DiningArea[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Reservation, 'id' | 'status'>>();

  name = '';
  phone = '';
  date = '';
  time = '';
  partySize = 2;
  areaPreference = '';
  notes = '';
  tags = {
    birthday: false,
    anniversary: false,
    vip: false,
    allergy: false,
    nonSmoking: false,
  };

  partySizeOptions = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (!this.name.trim() || !this.date || !this.time) return;
    const dateTime = new Date(`${this.date}T${this.time}`);
    this.saved.emit({
      guest: { name: this.name.trim(), phone: this.phone || undefined },
      dateTime,
      partySize: this.partySize,
      areaPreference: this.areaPreference || undefined,
      notes: this.notes || undefined,
      tags: { ...this.tags },
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  get activeAreas(): DiningArea[] {
    return this.areas.filter(a => a.isActive);
  }

  private resetForm(): void {
    this.name = '';
    this.phone = '';
    this.date = '';
    this.time = '';
    this.partySize = 2;
    this.areaPreference = '';
    this.notes = '';
    this.tags = { birthday: false, anniversary: false, vip: false, allergy: false, nonSmoking: false };
  }
}
