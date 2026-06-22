import { Component, Output, EventEmitter, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DashboardService } from '../../dashboard/services/dashboard.service';
import { SwitchComponent } from '../../../_shared/ui/switch/switch.component';
import { DateRange } from '../../dashboard/models/dashboard.models';

interface DateRangeOption {
  value: DateRange;
  label: string;
}

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, SwitchComponent],
  templateUrl: './top-nav.component.html',
})
export class TopNavComponent implements OnInit, OnDestroy {
  @Output() menuClick = new EventEmitter<void>();
  @Output() logoutClick = new EventEmitter<void>();
  @Input() compact = false;

  ranges: DateRangeOption[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'ytd', label: 'YTD' },
  ];

  currentTime = '';
  secondsAgo = 0;
  private lastUpdate = Date.now();
  private timerInterval?: ReturnType<typeof setInterval>;
  private destroy$ = new Subject<void>();

  constructor(
    public dashboardService: DashboardService,
  ) {}

  ngOnInit(): void {
    this.updateTime();
    this.timerInterval = setInterval(() => {
      this.secondsAgo = Math.floor((Date.now() - this.lastUpdate) / 1000);
      this.updateTime();
    }, 1000);

    // Sync timer with dashboard data fetches
    this.dashboardService.lastFetchTimestamp$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.resetUpdateTimer();
      });
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDateRangeChange(range: DateRange): void {
    this.dashboardService.dateRange$.next(range);
    this.resetUpdateTimer();
  }

  onAutoRefreshChange(value: boolean): void {
    this.dashboardService.autoRefresh$.next(value);
    if (value) this.resetUpdateTimer();
  }

  resetUpdateTimer(): void {
    this.lastUpdate = Date.now();
    this.secondsAgo = 0;
  }

  private updateTime(): void {
    this.currentTime = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }
}
