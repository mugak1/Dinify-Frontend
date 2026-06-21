// Reports master–detail shell. The persistent date-range bar and the report
// list live here, ABOVE the <router-outlet>, so they never unmount as you switch
// reports. >=lg renders a 240px left rail; below lg the list collapses to a
// horizontal pill selector. The shell is the parent route component — children
// (sales / placeholders) render in the outlet.

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ReportsService } from '../services/reports.service';
import { ReportDateRangeComponent } from '../components/report-date-range/report-date-range.component';
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
  imports: [CommonModule, RouterModule, ReportDateRangeComponent],
  templateUrl: './reports-shell.component.html',
})
export class ReportsShellComponent {
  readonly range$ = this.reports.dateRange$;

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
}
