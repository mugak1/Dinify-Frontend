// Shared preset date-range control. Owns no state — it reads `value` and emits
// `valueChange`, so the shell binds it straight to ReportsService.dateRange$.
// Emits zero-padded ISO ranges. Does NOT cap range length (the aggregate is
// uncapped; the ≤31-day guard lives in the Sales listing).

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { ReportDateRange, ReportPreset, presetToRange } from '../../models/reports.models';

interface PresetOption {
  value: ReportPreset;
  label: string;
}

@Component({
  selector: 'app-report-date-range',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <div class="flex flex-wrap items-center gap-2 w-full">
      <div class="flex flex-wrap items-center gap-1.5">
        @for (p of presets; track p.value) {
          <button
            app-dn-button
            [variant]="value.preset === p.value ? 'default' : 'outline'"
            size="sm"
            (click)="selectPreset(p.value)"
          >
            {{ p.label }}
          </button>
        }
      </div>

      @if (value.preset === 'custom') {
        <div class="flex items-center gap-2">
          <input
            type="date"
            class="text-[16px] border border-border rounded-md px-2 py-1 bg-card"
            aria-label="From date"
            [ngModel]="value.from"
            (ngModelChange)="onCustomFrom($event)"
          />
          <span class="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            class="text-[16px] border border-border rounded-md px-2 py-1 bg-card"
            aria-label="To date"
            [ngModel]="value.to"
            (ngModelChange)="onCustomTo($event)"
          />
        </div>
      }
    </div>
  `,
})
export class ReportDateRangeComponent {
  @Input() value: ReportDateRange = presetToRange('this-month');
  @Output() valueChange = new EventEmitter<ReportDateRange>();

  readonly presets: PresetOption[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'this-week', label: 'This week' },
    { value: 'last-week', label: 'Last week' },
    { value: 'this-month', label: 'This month' },
    { value: 'last-month', label: 'Last month' },
    { value: 'this-year', label: 'This year' },
    { value: 'custom', label: 'Custom' },
  ];

  selectPreset(preset: ReportPreset): void {
    if (preset === 'custom') {
      // Enter custom mode, seeding the two inputs from the current range.
      this.valueChange.emit({ preset: 'custom', from: this.value.from, to: this.value.to });
      return;
    }
    this.valueChange.emit(presetToRange(preset));
  }

  onCustomFrom(from: string): void {
    if (!from) return;
    // Keep from ≤ to so the downstream invariant always holds.
    const to = this.value.to && this.value.to >= from ? this.value.to : from;
    this.valueChange.emit({ preset: 'custom', from, to });
  }

  onCustomTo(to: string): void {
    if (!to) return;
    const from = this.value.from && this.value.from <= to ? this.value.from : to;
    this.valueChange.emit({ preset: 'custom', from, to });
  }
}
