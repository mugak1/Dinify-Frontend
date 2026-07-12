// Menu performance — the mock-first analytics surface (PR C of the Reports redesign).
//
// Orchestrator only. Menu has NO time-series: the timeframe just changes the window
// the aggregates/rankings cover (no buckets, no trend chart). Three range-aggregate
// chips (Items sold / Menu revenue / Avg item price) carry delta chips vs
// comparisonRange; a fourth, Active items, is POINT-IN-TIME (live menu via
// MenuService — fixed as the range changes, no delta, "as of now"). Top-selling
// items + the category breakdown / full menu read getMenuSummary. Reuses the PR-B
// primitives; the card maths live in the pure menu-view helpers.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject, Subject, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';
import { ReportsService } from '../services/reports.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { MenuService } from '../../menu/services/menu.service';
import { MenuItem } from '../../../_models/app.models';
import { comparisonRange } from '../utils/reports-timeframe';
import { MenuGrouping, MenuRow, ReportColumn, ReportDateRange, ReportPreset } from '../models/reports.models';
import { sumColumns } from '../data/reports-mock-data';
import { formatUGX } from '../../../_shared/utils/price-utils';
import { CategoryBar, EMPTY_MENU_TOTALS, MenuTotals, categoryBars, menuTotals } from './menu-view';
import { ReportStateComponent, ReportStateMode } from '../components/report-state/report-state.component';
import { ReportExportBarComponent } from '../components/report-export-bar/report-export-bar.component';
import { MenuStatCardComponent } from './menu-stat-card.component';
import { MenuTopItemsComponent } from './menu-top-items.component';
import { MenuCategoryComponent } from './menu-category.component';
import { PageHeaderComponent } from '../../../_shared/ui/page-header/page-header.component';

const ITEM_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Item', format: 'text', align: 'left' },
  { key: 'order_count', label: 'Orders', format: 'number', align: 'right', total: true },
  { key: 'quantity_sold', label: 'Qty sold', format: 'number', align: 'right', total: true },
  { key: 'revenue', label: 'Revenue', format: 'ugx', align: 'right', total: true },
];

const COMPARISON_LABELS: Partial<Record<ReportPreset, string>> = {
  today: 'vs yesterday',
  yesterday: 'vs prior day',
  'this-week': 'vs last week',
  'last-week': 'vs prior week',
  'this-month': 'vs last month',
  'last-month': 'vs prior month',
  'this-year': 'vs last year',
};

@Component({
  selector: 'app-menu-report',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    ReportStateComponent,
    ReportExportBarComponent,
    MenuStatCardComponent,
    MenuTopItemsComponent,
    MenuCategoryComponent,
  ],
  templateUrl: './menu-report.component.html',
})
export class MenuReportComponent implements OnInit, OnDestroy {
  readonly exportColumns = ITEM_COLUMNS;
  readonly fmt = formatUGX;
  /** Shared "compare to previous period" toggle — gates the delta chips. */
  readonly compareEnabled$ = this.reports.compareEnabled$;

  ready = false;
  state: ReportStateMode = 'loading';
  range: ReportDateRange | null = null;
  comparisonLabel = '';

  /** Shared grouping (sections/groups → category bars; items → full menu table). */
  grouping$ = new BehaviorSubject<MenuGrouping>('sections');
  grouping: MenuGrouping = 'sections';

  // Range-aggregate.
  current: MenuTotals = EMPTY_MENU_TOTALS;
  previous: MenuTotals | null = null;
  items: MenuRow[] = [];
  bars: CategoryBar[] = [];
  exportRows: MenuRow[] = [];
  exportTotals: Record<string, number> | null = null;

  // Point-in-time (live menu, range-independent).
  activeCount = 0;
  outOfStockCount = 0;

  private destroy$ = new Subject<void>();

  constructor(
    private reports: ReportsService,
    private auth: AuthenticationService,
    private menuService: MenuService,
  ) {}

  ngOnInit(): void {
    const restaurantId = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurantId) {
      this.state = 'error';
      return;
    }

    // Point-in-time active-items count from the LIVE menu — NOT range-scoped, loaded once.
    this.menuService.loadAllItems(restaurantId);
    this.menuService.allItems$.pipe(takeUntil(this.destroy$)).subscribe((menuItems: MenuItem[]) => {
      const active = menuItems.filter((i) => i.available);
      this.activeCount = active.length;
      this.outOfStockCount = active.filter((i) => !i.in_stock).length;
    });

    combineLatest([this.reports.dateRange$, this.reports.refresh$.pipe(startWith(undefined)), this.grouping$])
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.ready = false;
          this.state = 'loading';
        }),
        switchMap(([range, , grouping]) => {
          const cmp = comparisonRange(range);
          const items$ = this.reports
            .getMenuSummary(restaurantId, range.from, range.to, 'items')
            .pipe(catchError((error) => of({ data: null, error } as any)));
          const cmpItems$ = this.reports
            .getMenuSummary(restaurantId, cmp.from, cmp.to, 'items')
            .pipe(catchError(() => of({ data: null } as any)));
          // Category bars need the selected grouping; for items, reuse the items rows.
          const category$ =
            grouping === 'items'
              ? of({ data: null } as any)
              : this.reports
                  .getMenuSummary(restaurantId, range.from, range.to, grouping)
                  .pipe(catchError(() => of({ data: null } as any)));

          return combineLatest([items$, cmpItems$, category$]).pipe(
            map(([items, cmpItems, category]) => ({ range, grouping, items, cmpItems, category })),
          );
        }),
      )
      .subscribe((payload) => this.apply(payload));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onGrouping(value: MenuGrouping): void {
    this.grouping$.next(value);
  }

  showFullMenu(): void {
    this.grouping$.next('items');
  }

  retry(): void {
    this.reports.refresh$.next();
  }

  private apply(p: {
    range: ReportDateRange;
    grouping: MenuGrouping;
    items: any;
    cmpItems: any;
    category: any;
  }): void {
    this.range = p.range;
    this.grouping = p.grouping;

    const itemRows = p.items?.data as MenuRow[] | null;
    if (!itemRows) {
      this.ready = false;
      this.state = 'error';
      return;
    }
    if (itemRows.length === 0) {
      this.ready = false;
      this.state = 'empty';
      return;
    }

    this.items = itemRows;
    this.current = menuTotals(itemRows);
    const cmpRows = (p.cmpItems?.data ?? []) as MenuRow[];
    this.previous = cmpRows.length ? menuTotals(cmpRows) : null;
    this.comparisonLabel = COMPARISON_LABELS[p.range.preset] ?? 'vs prior period';

    const categoryRows = (p.grouping === 'items' ? itemRows : (p.category?.data ?? [])) as MenuRow[];
    this.bars = p.grouping === 'items' ? [] : categoryBars(categoryRows);

    this.exportRows = itemRows;
    this.exportTotals = sumColumns(itemRows, ['order_count', 'quantity_sold', 'revenue']);
    this.ready = true;
  }
}
