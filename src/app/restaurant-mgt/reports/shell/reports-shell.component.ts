// Reports shell. A sticky header holds the persistent timeframe cluster — date range
// AND comparison basis, both in the one shared picker; a segmented tab switcher sits
// beneath it and the report content runs full-width below — all ABOVE the
// <router-outlet>, so the header + tabs never unmount as you switch reports. The shell is
// the parent route component; children (sales / menu / transactions / diners) render in
// the outlet.
//
// The switcher is the shared `app-dn-segmented` control in router mode (routerLink
// anchors + white sliding glider). The shell owns only the URL→active derivation:
// `activeKey` is seeded from the URL and updated on NavigationEnd, then fed to the
// control as `[value]`. All glider geometry/measurement/ResizeObserver logic now lives
// inside the shared control. The switcher passes `queryParamsHandling="merge"` so the
// timeframe params ride along to the next tab instead of being dropped.
//
// BOTH the date range and the comparison basis are owned by the route-scoped
// `TimeframeService`, where the URL is the source of truth — this shell only reads
// `range$` / `comparison$` and hands picker output back to `set()` / `setComparison()`.
// The old localStorage-backed `ReportsService.compareEnabled$` toggle is gone (02A): a
// boolean cannot express "compare against the same weekday last year", and keeping both
// would have left two places to ask what a number is measured against.

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { DnSegmentedComponent, DnSegItem } from '../../../_shared/ui/segmented/segmented.component';
import {
  ComparisonOption,
  ReportDateRange,
  TimeframePickerComponent,
  TimeframeService,
} from '../../../_shared/timeframe';
import { ReportKey } from '../models/reports.models';

@Component({
  selector: 'app-reports-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, TimeframePickerComponent, DnSegmentedComponent],
  templateUrl: './reports-shell.component.html',
})
export class ReportsShellComponent {
  readonly range$ = this.timeframe.range$;
  readonly comparison$ = this.timeframe.comparison$;

  /** Segments for the shared control. `value` doubles as the report key; `icon` is the opaque
   *  key the projected `#icon` template resolves to an inline SVG. */
  readonly reportNav: DnSegItem[] = [
    { value: 'sales', label: 'Sales', path: 'sales', icon: 'sales' },
    { value: 'menu', label: 'Menu performance', path: 'menu', icon: 'menu' },
    { value: 'transactions', label: 'Transactions', path: 'transactions', icon: 'card' },
    { value: 'diners', label: 'Diners', path: 'diners', icon: 'users' },
  ];

  /** Active report, derived from the URL and fed to the control as `[value]`. */
  readonly activeKey = signal<ReportKey>('sales');

  constructor(
    private timeframe: TimeframeService,
    private router: Router,
    public route: ActivatedRoute,
  ) {
    // Seed synchronously so a deep-link (e.g. /reports/menu) starts with the glider already
    // under the correct tab — this route's initial NavigationEnd may have fired before the
    // component existed, so we cannot rely on the event stream alone.
    this.activeKey.set(this.keyFromUrl(this.router.url));

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.activeKey.set(this.keyFromUrl(this.router.url)));
  }

  onRange(range: ReportDateRange): void {
    this.timeframe.set(range);
  }

  onComparison(option: ComparisonOption): void {
    this.timeframe.setComparison(option);
  }

  /** Last matching report segment in the URL, ignoring query/fragment/trailing
   *  slashes; defaults to 'sales' (the empty-path redirect target). */
  private keyFromUrl(url: string): ReportKey {
    const segments = url.split(/[?#]/)[0].split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const match = this.reportNav.find((n) => n.path === segments[i]);
      if (match) return match.value as ReportKey;
    }
    return 'sales';
  }
}
