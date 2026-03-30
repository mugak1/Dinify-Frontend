import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { ItemDiscountDetails } from 'src/app/_models/app.models';

@Component({
  selector: 'app-item-discounts-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, SwitchComponent],
  templateUrl: './item-discounts-tab.component.html',
})
export class ItemDiscountsTabComponent implements OnChanges {
  @Input() hasDiscount = false;
  @Input() discountDetails: ItemDiscountDetails | null = null;
  @Input() primaryPrice = 0;

  @Output() discountChange = new EventEmitter<{
    hasDiscount: boolean;
    discountDetails: ItemDiscountDetails;
  }>();

  enabled = false;
  discountAmount = 0;
  startDate = '';
  endDate = '';
  recurringDays: number[] = [];

  readonly weekdays = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 7, label: 'Sun' },
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['hasDiscount'] || changes['discountDetails']) {
      this.enabled = this.hasDiscount;
      if (this.discountDetails) {
        this.discountAmount = this.discountDetails.discount_amount ?? 0;
        this.startDate = this.discountDetails.start_date ?? '';
        this.endDate = this.discountDetails.end_date ?? '';
        this.recurringDays = [...(this.discountDetails.recurring_days ?? [])];
      } else {
        this.discountAmount = 0;
        this.startDate = '';
        this.endDate = '';
        this.recurringDays = [];
      }
    }
  }

  onToggleDiscount(value: boolean): void {
    this.enabled = value;
    this.emitChange();
  }

  toggleDay(day: number): void {
    const idx = this.recurringDays.indexOf(day);
    if (idx >= 0) {
      this.recurringDays.splice(idx, 1);
    } else {
      this.recurringDays.push(day);
      this.recurringDays.sort((a, b) => a - b);
    }
    this.emitChange();
  }

  isDaySelected(day: number): boolean {
    return this.recurringDays.includes(day);
  }

  get priceAfterDiscount(): number {
    return Math.max(0, this.primaryPrice - this.discountAmount);
  }

  get isAmountTooHigh(): boolean {
    return this.discountAmount >= this.primaryPrice && this.primaryPrice > 0;
  }

  formatUGX(amount: number): string {
    return amount.toLocaleString('en-UG');
  }

  emitChange(): void {
    this.discountChange.emit({
      hasDiscount: this.enabled,
      discountDetails: {
        discount_amount: this.discountAmount,
        start_date: this.startDate,
        end_date: this.endDate,
        recurring_days: this.recurringDays,
      },
    });
  }
}
