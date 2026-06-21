// Menu performance report. A single aggregate table (no per-order listing, no
// >31-day guard, no pagination) with a grouping toggle that re-fetches the
// matching set. State + data come from ReportsService (mock-first). No charts,
// no KPI tiles.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject, Subject, combineLatest, of } from 'rxjs';
import { catchError, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { ReportsService } from '../services/reports.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ReportTableComponent } from '../components/report-table/report-table.component';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { CardComponent } from '../../../_shared/ui/card/card.component';
import {
  TabsComponent,
  TabListComponent,
  TabTriggerComponent,
} from '../../../_shared/ui/tabs/tabs.component';
import { MenuGrouping, MenuRow, ReportColumn } from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';

// OMIT average_rating — it is an all-null scaffold on the backend for now.
const MENU_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Name', format: 'text', align: 'left' },
  { key: 'order_count', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'quantity_sold', label: 'Qty sold', format: 'number', align: 'right', total: true },
  { key: 'revenue', label: 'Revenue', format: 'ugx', align: 'right', total: true },
];

const GROUPINGS: { value: MenuGrouping; label: string }[] = [
  { value: 'sections', label: 'Sections' },
  { value: 'groups', label: 'Groups' },
  { value: 'items', label: 'Items' },
];

@Component({
  selector: 'app-menu-report',
  standalone: true,
  imports: [
    CommonModule,
    ReportTableComponent,
    ReportStateComponent,
    CardComponent,
    TabsComponent,
    TabListComponent,
    TabTriggerComponent,
  ],
  templateUrl: './menu-report.component.html',
})
export class MenuReportComponent implements OnInit, OnDestroy {
  readonly columns = MENU_COLUMNS;
  readonly groupings = GROUPINGS;

  /** Drives the grouping toggle; folded into the fetch stream so switching re-fetches. */
  grouping$ = new BehaviorSubject<MenuGrouping>('sections');

  rows: MenuRow[] = [];
  totals: Record<string, number> | null = null;
  ready = false;
  state: ReportStateMode = 'loading';

  private destroy$ = new Subject<void>();

  constructor(
    private reports: ReportsService,
    private auth: AuthenticationService,
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) {
      this.state = 'error';
      return;
    }

    combineLatest([
      this.reports.dateRange$,
      this.reports.refresh$.pipe(startWith(undefined)),
      this.grouping$,
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.ready = false;
          this.state = 'loading';
        }),
        switchMap(([range, , grouping]) =>
          // NOTE: the real menu-summary endpoint currently caps at >31-day ranges
          // (a backend PR relaxes it). Under mock the generator renders at every
          // range; once the cap lands, add a listing-guard-style guard here.
          this.reports
            .getMenuSummary(restaurantId, range.from, range.to, grouping)
            .pipe(catchError((err) => of({ data: null, error: err } as any))),
        ),
      )
      .subscribe((res) => this.apply(res));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onGrouping(value: string): void {
    this.grouping$.next(value as MenuGrouping);
  }

  retry(): void {
    this.reports.refresh$.next();
  }

  private apply(res: any): void {
    const rows: MenuRow[] | null = res?.data ?? null;
    if (!rows) {
      this.ready = false;
      this.state = 'error';
      return;
    }
    this.rows = rows;
    if (rows.length) {
      this.totals = sumColumns(rows, ['order_count', 'quantity_sold', 'revenue']);
      this.ready = true;
    } else {
      this.totals = null;
      this.ready = false;
      this.state = 'empty';
    }
  }
}
