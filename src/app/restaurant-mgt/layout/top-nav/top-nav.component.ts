import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardService } from '../../dashboard/services/dashboard.service';
import { DateRange } from '../../dashboard/models/dashboard.models';
import { DnSegmentedComponent } from '../../../_shared/ui/segmented/segmented.component';
import { AuthenticationService } from '../../../_services/authentication.service';

interface DateRangeOption {
  value: DateRange;
  label: string;
}

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, DnSegmentedComponent],
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
    private auth: AuthenticationService,
  ) {}

  /**
   * The current restaurant's name, surfaced in the chrome so a multi-venue
   * operator always sees which venue they're editing (the shell fetches the
   * detail but rendered the name nowhere). Prefer the freshly-fetched detail
   * (`current_resta`, reflects an in-session rename); fall back to the
   * membership label (`rest_role.restaurant`), which is present immediately on
   * first paint before the detail request resolves.
   */
  get restaurantName(): string {
    return this.auth.currentRestaurant?.name || this.auth.currentRestaurantRole?.restaurant || '';
  }

  onDateRangeChange(range: DateRange): void {
    this.dashboardService.dateRange$.next(range);
  }
}
