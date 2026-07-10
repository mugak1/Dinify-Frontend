import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from '../../dashboard/services/dashboard.service';
import { DateRange } from '../../dashboard/models/dashboard.models';

interface DateRangeOption {
  value: DateRange;
  label: string;
}

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './top-nav.component.html',
})
export class TopNavComponent {
  @Output() menuClick = new EventEmitter<void>();
  @Output() logoutClick = new EventEmitter<void>();
  @Input() compact = false;

  ranges: DateRangeOption[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'ytd', label: 'YTD' },
  ];

  constructor(
    public dashboardService: DashboardService,
  ) {}

  onDateRangeChange(range: DateRange): void {
    this.dashboardService.dateRange$.next(range);
  }
}
