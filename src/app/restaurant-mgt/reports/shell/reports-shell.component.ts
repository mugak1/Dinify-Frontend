// Reports shell. A sticky header holds the persistent date-range bar and the
// "Compare to previous period" toggle; a segmented-rail tab switcher sits beneath
// it and the report content runs full-width below — all ABOVE the <router-outlet>,
// so the header + tabs never unmount as you switch reports. The shell is the parent
// route component; children (sales / menu / transactions / diners) render in the outlet.
//
// The switcher is a "segmented rail": a single sunken pill track with four equal
// segments and one absolutely-positioned red "glider" card that slides between them
// to mark the active report. The glider's geometry is measured off the active anchor's
// offsetLeft/offsetWidth (they share the relative track as offset parent, so the 5px
// padding + 1px border cancel out) and re-synced on navigation and on any track-width
// change (window resize, sidebar collapse/expand, scrollbar) via a ResizeObserver.

import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  QueryList,
  ViewChild,
  ViewChildren,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
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
export class ReportsShellComponent implements AfterViewInit {
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

  // ── Segmented-rail glider state ────────────────────────────────────────────
  /** Active report, derived from the URL. Drives segment colouring AND which anchor
   *  the glider tracks — a single source of truth (replaces routerLinkActive). */
  readonly activeKey = signal<ReportKey>('sales');
  /** Glider geometry in px, read from the active anchor's offsetLeft/offsetWidth. */
  readonly gliderLeft = signal(0);
  readonly gliderWidth = signal(0);
  /** Transition stays OFF until the first measurement lands, so the glider never
   *  slides in from left:0/width:0 on first paint (see ngAfterViewInit). */
  readonly ready = signal(false);
  /** The sliding-card easing, applied only once `ready()` is true. */
  readonly gliderTransition =
    'left 0.3s cubic-bezier(0.22, 1, 0.36, 1), width 0.3s cubic-bezier(0.22, 1, 0.36, 1)';

  @ViewChild('trackEl') private trackEl?: ElementRef<HTMLElement>;
  @ViewChildren('tabEl') private tabEls!: QueryList<ElementRef<HTMLAnchorElement>>;

  private readonly destroyRef = inject(DestroyRef);
  private resizeObserver?: ResizeObserver;

  constructor(
    private reports: ReportsService,
    private router: Router,
    private zone: NgZone,
  ) {
    // Seed synchronously so a deep-link (e.g. /reports/menu) starts with the glider
    // already under the correct tab — this route's initial NavigationEnd may have fired
    // before the component existed, so we cannot rely on the event stream alone.
    this.activeKey.set(this.keyFromUrl(this.router.url));

    // Subsequent tab switches: recolour immediately, reposition the glider next frame.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.activeKey.set(this.keyFromUrl(this.router.url));
        requestAnimationFrame(() => this.syncGlider());
      });
  }

  ngAfterViewInit(): void {
    // First placement: measure next frame (layout + fonts settled), then enable the
    // transition ONE further frame later so this first jump is instant, not a slide-in.
    requestAnimationFrame(() => {
      this.syncGlider();
      requestAnimationFrame(() => this.ready.set(true));
    });

    // Re-measure on ANY track-width change: window resize, sidebar expand/collapse, or a
    // content scrollbar appearing — the latter two fire no window resize event. RO callbacks
    // run outside the Angular zone, so re-enter it to flush the signal writes.
    if (this.trackEl && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.zone.run(() => this.syncGlider()));
      this.resizeObserver.observe(this.trackEl.nativeElement);
      this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    }
  }

  onRange(range: ReportDateRange): void {
    this.reports.dateRange$.next(range);
  }

  onCompareToggle(enabled: boolean): void {
    this.reports.compareEnabled$.next(enabled);
  }

  isActive(item: ReportNavItem): boolean {
    return this.activeKey() === item.key;
  }

  /** Place the glider over the active anchor. offsetLeft/offsetWidth are measured
   *  against the `relative` track (the anchors' offsetParent), and the glider's
   *  absolute `left` resolves against that same track padding-box — so the track's
   *  5px padding / 1px border cancel out. No-ops until the view is laid out. */
  private syncGlider(): void {
    const index = this.reportNav.findIndex((n) => n.key === this.activeKey());
    const el = this.tabEls?.get(index)?.nativeElement;
    if (!el) return;
    this.gliderLeft.set(el.offsetLeft);
    this.gliderWidth.set(el.offsetWidth);
  }

  /** Last matching report segment in the URL, ignoring query/fragment/trailing
   *  slashes; defaults to 'sales' (the empty-path redirect target). */
  private keyFromUrl(url: string): ReportKey {
    const segments = url.split(/[?#]/)[0].split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const match = this.reportNav.find((n) => n.path === segments[i]);
      if (match) return match.key;
    }
    return 'sales';
  }
}
