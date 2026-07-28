// The period arrows live in ONE shared picker, so both timeframe hosts get them from a
// single change — and this is the spec that proves it, through the REAL router with the
// production route providers rather than a synthetic harness.
//
// Two things are pinned per host:
//   1. the arrows actually RENDER inside that host's own template (the Dashboard mounts
//      the picker in `app-page-header`'s actions slot, the Reports shell in its sticky
//      bar — either could drop the control and nothing else would fail);
//   2. a click steps the window by one PERIOD and that lands in the URL, which is the
//      source of truth both hosts read back.
//
// Dates are deliberately in 2020 so nothing here depends on when the suite runs, and
// March 2020 → February 2020 exercises a LEAP-year month length end to end.

import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';

import { DashboardComponent } from './dashboard/dashboard.component';
import { DashboardService } from './dashboard/services/dashboard.service';
import { MenuService } from './menu/services/menu.service';
import { ReportsShellComponent } from './reports/shell/reports-shell.component';
import { ApiService } from '../_services/api.service';
import { AuthenticationService } from '../_services/authentication.service';
import { LocalStorageService } from '../_services/storage/local-storage.service';
import { TIMEFRAME_CONFIG, TimeframeService } from '../_shared/timeframe';
import { TimeframePickerComponent } from '../_shared/timeframe/picker/timeframe-picker.component';

const DASHBOARD_CONFIG = { seedKey: 'dashboard.timeframe', defaultPreset: 'today' as const };
const REPORTS_CONFIG = { seedKey: 'reports.dateRange', defaultPreset: 'this-month' as const };

/** A whole calendar March 2020 — long past, so the expectations never age. */
const MARCH_2020 = '?from=2020-03-01&to=2020-03-31&preset=custom';

describe('period arrows — both timeframe hosts', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  /**
   * Let the deferred entry URL write, and the navigation it starts, complete — two
   * macrotasks, for the same reason timeframe-host-isolation.spec.ts needs two.
   */
  const flush = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      // DashboardComponent is non-standalone; the picker is imported for real so the
      // arrows render, while every OTHER child card stays inert under NO_ERRORS_SCHEMA.
      declarations: [DashboardComponent],
      imports: [TimeframePickerComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA],
      providers: [
        provideRouter([
          {
            path: 'dashboard',
            component: DashboardComponent,
            providers: [
              TimeframeService,
              { provide: TIMEFRAME_CONFIG, useValue: DASHBOARD_CONFIG },
            ],
          },
          {
            path: 'reports',
            component: ReportsShellComponent,
            providers: [TimeframeService, { provide: TIMEFRAME_CONFIG, useValue: REPORTS_CONFIG }],
          },
        ]),
        {
          provide: DashboardService,
          useValue: {
            // Real subjects, not `of(...)`: the component calls `.next()` on the
            // timestamp after every fetch.
            refresh$: new Subject<void>(),
            lastFetchTimestamp$: new BehaviorSubject<number>(0),
            getDashboardData: () => of({ data: null }),
            getReviewsSummary: () => of({ data: null }),
          },
        },
        { provide: MenuService, useValue: { loadAllItems: () => undefined, allItems$: of([]) } },
        {
          provide: ApiService,
          useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']),
        },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => undefined } },
      ],
    });
  });

  async function bootAt(url: string): Promise<HTMLElement> {
    harness = await RouterTestingHarness.create(url);
    router = TestBed.inject(Router);
    await flush();
    harness.detectChanges();
    return harness.routeDebugElement!.nativeElement as HTMLElement;
  }

  const arrow = (host: HTMLElement, label: string): HTMLButtonElement =>
    host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

  const queryOf = (): Record<string, string> =>
    Object.fromEntries(new URL(router.url, 'http://x').searchParams.entries());

  async function click(host: HTMLElement, label: string): Promise<void> {
    arrow(host, label).click();
    harness.detectChanges();
    await flush();
  }

  const hosts: { label: string; url: string }[] = [
    { label: 'the Dashboard', url: '/dashboard' },
    { label: 'the Reports shell', url: '/reports' },
  ];

  for (const host of hosts) {
    describe(host.label, () => {
      it('renders both period arrows beside the date control', async () => {
        const el = await bootAt(host.url + MARCH_2020);

        expect(el.querySelector('app-timeframe-picker')).not.toBeNull();
        expect(arrow(el, 'Previous period')).not.toBeNull();
        expect(arrow(el, 'Next period')).not.toBeNull();
      });

      it('steps back one whole calendar month and publishes it to the URL', async () => {
        const el = await bootAt(host.url + MARCH_2020);
        await click(el, 'Previous period');

        // February 2020 — 29 days, because 2020 is a leap year.
        expect(queryOf()).toEqual({ from: '2020-02-01', to: '2020-02-29', preset: 'custom' });
      });

      it('steps forward one whole calendar month and publishes it to the URL', async () => {
        const el = await bootAt(host.url + MARCH_2020);
        await click(el, 'Next period');

        expect(queryOf()).toEqual({ from: '2020-04-01', to: '2020-04-30', preset: 'custom' });
      });

      it('keeps the window the same length across repeated steps back', async () => {
        const el = await bootAt(host.url + '?from=2020-03-10&to=2020-03-14&preset=custom');

        await click(el, 'Previous period');
        expect(queryOf()['from']).toBe('2020-03-05');
        expect(queryOf()['to']).toBe('2020-03-09');

        await click(el, 'Previous period');
        expect(queryOf()['from']).toBe('2020-02-29');
        expect(queryOf()['to']).toBe('2020-03-04');
      });

      it('disables the forward arrow once the range reaches the present', async () => {
        const el = await bootAt(host.url); // no params → the host default, which ends today

        expect(arrow(el, 'Next period').disabled).toBeTrue();
        expect(arrow(el, 'Previous period').disabled).toBeFalse();
      });
    });
  }
  // ─── Comparison control, per host (TIMEFRAME-02B) ──────────────────────────────────
  //
  // The picker is SHARED, and as of 02B BOTH hosts render the full cluster — the
  // `showComparison` flag that held the dropdown off the Dashboard through 02A is gone.
  //
  // This is the successor to 02A's "scoped to Reports until 02B" block, not a deletion of
  // it: the same two mounts are still asserted, with the Dashboard's expectation inverted.
  // Component-level coverage of the dropdown lives in the picker's own spec; what only
  // THIS file can catch is a host quietly dropping the control from its own template.
  describe('the comparison dropdown renders on both hosts', () => {
    const cmpTrigger = (el: HTMLElement): HTMLButtonElement | null =>
      el.querySelector('button[aria-haspopup="listbox"]');

    for (const host of hosts) {
      it(`${host.label} renders it beside the date control`, async () => {
        const el = await bootAt(host.url + MARCH_2020);

        expect(el.querySelector('app-timeframe-picker')).not.toBeNull();
        expect(cmpTrigger(el)).not.toBeNull();
        // The whole cluster, in one place: arrows, date trigger, comparison.
        expect(arrow(el, 'Previous period')).not.toBeNull();
        expect(arrow(el, 'Next period')).not.toBeNull();
      });
    }

    // TIMEFRAME-TIDY-00 moved the picker onto the FETCHED window, and the picker is
    // shared — so a change made for Reports reaches the Dashboard's menu whether or not
    // anyone looked. March 2020 is a whole calendar month, nowhere near the annual clamp,
    // which is the ordinary case both hosts actually run in: the menu must not move.
    const cmpLabels = (): string[] =>
      Array.from(
        document.querySelector('.dn-comparison-overlay-panel')?.querySelectorAll('[role="option"]') ??
          [],
      ).map((b) => (b.textContent ?? '').trim());

    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    });

    for (const host of hosts) {
      it(`${host.label} offers the unchanged month menu for an ordinary range`, async () => {
        const el = await bootAt(host.url + MARCH_2020);

        cmpTrigger(el)!.click();
        harness.detectChanges();

        expect(cmpLabels()).toEqual([
          'No comparison',
          'Previous month by day (Mon–Sun)',
          'Previous month by date (DD/MM)',
          'Previous year by day (Mon–Sun)',
          'Dates last year (DD/MM)',
          'Custom period',
        ]);
      });
    }
  });
});
