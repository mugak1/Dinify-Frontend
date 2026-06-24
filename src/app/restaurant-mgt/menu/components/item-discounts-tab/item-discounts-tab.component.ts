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
  discountType: 'percentage' | 'fixed' = 'fixed';
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
        this.discountType = this.discountDetails.discount_type ?? 'fixed';
        this.discountAmount = this.discountDetails.discount_amount ?? 0;
        this.startDate = this.discountDetails.start_date ?? '';
        this.endDate = this.discountDetails.end_date ?? '';
        this.recurringDays = [...(this.discountDetails.recurring_days ?? [])];
      } else {
        this.discountType = 'fixed';
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

  onDiscountTypeChange(type: 'percentage' | 'fixed'): void {
    this.discountType = type;
    this.discountAmount = 0;
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
    if (this.discountType === 'percentage') {
      return Math.round(this.primaryPrice * (1 - this.discountAmount / 100));
    }
    return Math.max(0, this.primaryPrice - this.discountAmount);
  }

  get savings(): number {
    return this.primaryPrice - this.priceAfterDiscount;
  }

  get isAmountTooHigh(): boolean {
    if (this.primaryPrice <= 0) return false;
    if (this.discountType === 'percentage') {
      return this.discountAmount < 1 || this.discountAmount > 99;
    }
    return this.discountAmount >= this.primaryPrice;
  }

  get validationMessage(): string {
    if (this.discountType === 'percentage') {
      return 'Percentage must be between 1 and 99';
    }
    return 'Discount amount must be less than the item price (UGX ' + this.formatUGX(this.primaryPrice) + ')';
  }

  /** Hard error: both dates set AND end strictly before start. Lexical < on
   *  'YYYY-MM-DD' equals chronological <. end === start is a valid one-day window. */
  get hasDateError(): boolean {
    return !!this.startDate && !!this.endDate && this.endDate < this.startDate;
  }

  /** Advisory only (never blocks save): end date already before today (device-local).
   *  Suppressed when hasDateError wins or endDate is empty. end === today is NOT past. */
  get isWindowPast(): boolean {
    if (!this.endDate || this.hasDateError) return false;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return this.endDate < today;
  }

  formatUGX(amount: number): string {
    return amount.toLocaleString('en-UG');
  }

  emitChange(): void {
    this.discountChange.emit({
      hasDiscount: this.enabled,
      discountDetails: {
        discount_type: this.discountType,
        discount_amount: this.discountAmount,
        start_date: this.startDate,
        end_date: this.endDate,
        recurring_days: this.recurringDays,
      },
    });
  }
}
