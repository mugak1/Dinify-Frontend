// Reports shell. A sticky header holds the persistent date-range bar and the
// "Compare to previous period" toggle; a horizontal tab strip sits beneath it and
// the report content runs full-width below — all ABOVE the <router-outlet>, so the
// header + tabs never unmount as you switch reports. The shell is the parent route
// component; children (sales / menu / transactions / diners) render in the outlet.

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { map } from 'rxjs/operators';
import { ReportsService } from '../services/reports.service';
import { ReportDateRangeComponent } from '../components/report-date-range/report-date-range.component';
import { SwitchComponent } from '../../../_shared/ui/switch/switch.component';
import { comparisonRangeLabel } from '../utils/reports-timeframe';
import { ReportDateRange, ReportKey } from '../models/reports.models';

interface ReportNavItem {
  key: ReportKey;
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-reports-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, ReportDateRangeComponent, SwitchComponent],
  templateUrl: './reports-shell.component.html',
})
export class ReportsShellComponent {
  readonly range$ = this.reports.dateRange$;
  readonly compareEnabled$ = this.reports.compareEnabled$;
  /** "Compare to {label}" — the label reflects the comparison period for the active range. */
  readonly compareLabel$ = this.range$.pipe(map((r) => comparisonRangeLabel(r)));

  readonly reportNav: ReportNavItem[] = [
    { key: 'sales', label: 'Sales', path: 'sales', icon: 'sales' },
    { key: 'menu', label: 'Menu performance', path: 'menu', icon: 'menu' },
    { key: 'transactions', label: 'Transactions', path: 'transactions', icon: 'card' },
    { key: 'diners', label: 'Diners', path: 'diners', icon: 'users' },
  ];

  constructor(private reports: ReportsService) {}

  onRange(range: ReportDateRange): void {
    this.reports.dateRange$.next(range);
  }

  onCompareToggle(enabled: boolean): void {
    this.reports.compareEnabled$.next(enabled);
  }
}
