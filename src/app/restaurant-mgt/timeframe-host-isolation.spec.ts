// Two timeframe hosts, one router. This pins the three properties that make a
// route-scoped TimeframeService the right shape, all of which fail SILENTLY:
//
//   1. Each host lands on ITS OWN default. Dashboard asks "how are we doing now" and
//      opens on Today; Reports asks "what happened over this period" and opens on
//      month-to-date.
//   2. Each host writes ITS OWN localStorage seed. A Dashboard that opened on last month
//      because you were doing month-end reporting in Reports yesterday is wrong, and
//      nothing would ever throw to tell you.
//   3. A route with NO timeframe carries no timeframe params. This is the whole reason
//      the service is not providedIn:'root' — a root-provided instance would stamp
//      ?from=&to= onto every page in the portal.
//
// Driven through the REAL router with the production route shape, including the detail
// that the dashboard route is a LEAF with providers (Reports is a parent with children,
// and only the parent case had prior coverage).

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { format } from 'date-fns';

import { TIMEFRAME_CONFIG, TimeframeService } from '../_shared/timeframe';
import { AuthenticationService } from '../_services/authentication.service';
import { LocalStorageService } from '../_services/storage/local-storage.service';

@Component({ standalone: true, template: '' })
class HostComponent {}

const DASHBOARD_CONFIG = { seedKey: 'dashboard.timeframe', defaultPreset: 'today' as const };
const REPORTS_CONFIG = { seedKey: 'reports.dateRange', defaultPreset: 'this-month' as const };

const DASHBOARD_KEY = 'dashboard.timeframe:r1';
const REPORTS_KEY = 'reports.dateRange:r1';
const today = format(new Date(), 'yyyy-MM-dd');

describe('timeframe hosts — isolation and route scoping', () => {
  let stored: Record<string, unknown>;
  let setItem: jasmine.Spy;
  let harness: RouterTestingHarness;
  let router: Router;

  /**
   * Let the deferred entry URL write, and the navigation it starts, complete.
   *
   * Two macrotasks, not one: the entry correction is deferred a microtask past route
   * activation and THEN starts its own navigation, so on a re-entry (where a navigation
   * is already settling) a single tick lands between the two and reads a bare URL.
   */
  const flush = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  beforeEach(() => {
    stored = {};
    setItem = jasmine.createSpy('setItem').and.callFake((k: string, v: unknown) => {
      stored[k] = v;
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          // LEAF route with providers — the exact shape the dashboard uses in production.
          {
            path: 'dashboard',
            component: HostComponent,
            providers: [TimeframeService, { provide: TIMEFRAME_CONFIG, useValue: DASHBOARD_CONFIG }],
          },
          {
            path: 'reports',
            component: HostComponent,
            providers: [TimeframeService, { provide: TIMEFRAME_CONFIG, useValue: REPORTS_CONFIG }],
          },
          // No timeframe on these.
          { path: 'menu', component: HostComponent },
          { path: 'settings', component: HostComponent },
        ]),
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        {
          provide: LocalStorageService,
          useValue: { getItem: (k: string) => stored[k] ?? null, setItem },
        },
      ],
    });
  });

  async function bootAt(url: string): Promise<TimeframeService> {
    harness = await RouterTestingHarness.create(url);
    router = TestBed.inject(Router);
    const service = harness.routeDebugElement!.injector.get(TimeframeService);
    await flush();
    return service;
  }

  const queryOf = (): Record<string, string> =>
    Object.fromEntries(new URL(router.url, 'http://x').searchParams.entries());

  describe('per-host defaults', () => {
    it('the dashboard lands on Today', async () => {
      const service = await bootAt('/dashboard');

      expect(service.value.preset).toBe('today');
      expect(service.value.from).toBe(today);
      expect(service.value.to).toBe(today);
      expect(queryOf()).toEqual({ from: today, to: today, preset: 'today' });
    });

    it('reports lands on month-to-date', async () => {
      const service = await bootAt('/reports');

      expect(service.value.preset).toBe('this-month');
      expect(service.value.to).toBe(today);
      expect(queryOf()['preset']).toBe('this-month');
    });
  });

  describe('seed isolation', () => {
    it('each host reads only its own seed', async () => {
      stored[REPORTS_KEY] = { preset: 'custom', from: '2026-02-01', to: '2026-02-14' };

      // The dashboard must ignore the Reports memo entirely and take its own default.
      const service = await bootAt('/dashboard');

      expect(service.value.preset).toBe('today');
      expect(service.value.from).toBe(today);
    });

    it('each host writes only its own seed', async () => {
      const service = await bootAt('/dashboard');

      service.set({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });

      expect(stored[DASHBOARD_KEY]).toEqual({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });
      expect(setItem).not.toHaveBeenCalledWith(REPORTS_KEY, jasmine.anything());
    });

    it('a range set on one host does not leak to the other', async () => {
      // Seed reports so its entry is deterministic and distinct from the dashboard's.
      stored[REPORTS_KEY] = { preset: 'custom', from: '2026-02-01', to: '2026-02-14' };

      const reports = await bootAt('/reports');
      reports.set({ preset: 'custom', from: '2026-04-01', to: '2026-04-30' });
      await flush();

      await harness.navigateByUrl('/dashboard');
      await flush();
      const dashboard = harness.routeDebugElement!.injector.get(TimeframeService);

      // Distinct instances, and the dashboard's memo was never touched.
      expect(dashboard).not.toBe(reports);
      expect(stored[DASHBOARD_KEY]).toBeUndefined();
      expect(stored[REPORTS_KEY]).toEqual({ preset: 'custom', from: '2026-04-01', to: '2026-04-30' });
    });
  });

  it('honours a dashboard deep link verbatim', async () => {
    const service = await bootAt('/dashboard?from=2026-05-01&to=2026-05-31&preset=custom');

    expect(service.value).toEqual({ preset: 'custom', from: '2026-05-01', to: '2026-05-31' });
    // A shared link is left exactly as the sharer wrote it.
    expect(queryOf()).toEqual({ from: '2026-05-01', to: '2026-05-31', preset: 'custom' });
  });

  // The route-scoping guarantee. Sidebar links carry no `queryParamsHandling`, so
  // Angular's default drops query params on navigation — and once the host route is
  // deactivated its service is torn down and can no longer publish. Both halves have to
  // hold; this asserts the observable result of the pair.
  describe('routes with no timeframe carry no timeframe params', () => {
    it('leaves no ?from= behind when navigating dashboard → menu → settings', async () => {
      await bootAt('/dashboard');
      expect(router.url).toContain('from='); // the host DOES publish

      await harness.navigateByUrl('/menu');
      await flush(); // load-bearing: a synchronous assert would pass for the wrong reason
      expect(router.url).toBe('/menu');

      await harness.navigateByUrl('/settings');
      await flush();
      expect(router.url).toBe('/settings');
    });

    it('leaves no ?from= behind when navigating reports → menu', async () => {
      await bootAt('/reports');
      expect(router.url).toContain('from=');

      await harness.navigateByUrl('/menu');
      await flush();

      expect(router.url).toBe('/menu');
    });

    // Angular caches a route's EnvironmentInjector against the route CONFIG, not against
    // each activation, so returning to a timeframe host REUSES the existing service —
    // its constructor, and therefore `resolveOnEntry`, runs once per app load. Two
    // consequences, both pinned here because they are easy to misread as bugs:
    //
    //   - The in-memory range SURVIVES the round trip (the picker and the data stay
    //     correct), but the URL is not re-published, so it reads bare `/dashboard`.
    //     Copying the link at that moment shares the default rather than what is on
    //     screen. This is pre-existing behaviour from 01A — Reports does exactly the same
    //     — not something the Dashboard adoption introduced.
    //   - Because the service outlives the route visit, it is still subscribed to the
    //     root query params while the user is on Menu. That is safe only because
    //     `adoptFromUrl` is inert on absent params and never navigates; if it ever
    //     started writing, it would stamp params onto every page in the portal.
    it('keeps its range across a round trip without stamping params elsewhere', async () => {
      const service = await bootAt('/dashboard');
      service.set({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });
      await flush();

      await harness.navigateByUrl('/menu');
      await flush();
      expect(router.url).toBe('/menu');

      await harness.navigateByUrl('/dashboard');
      await flush();
      // The range is intact even though the URL no longer spells it out.
      expect(service.value).toEqual({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });

      await harness.navigateByUrl('/settings');
      await flush();

      expect(router.url).toBe('/settings');
    });
  });
  // ─── Comparison basis (TIMEFRAME-02A) ──────────────────────────────────────────────
  //
  // The basis is route-scoped state alongside the range, so it inherits all three
  // properties above and each is asserted here for the same silent-failure reason.
  describe('comparison basis — per-host isolation', () => {
    const DASHBOARD_CMP_KEY = 'dashboard.timeframe.cmp:r1';
    const REPORTS_CMP_KEY = 'reports.dateRange.cmp:r1';

    it('each host lands on the default for ITS OWN shape', async () => {
      // Dashboard opens on Today → a day shape → prev-day.
      const dashboard = await bootAt('/dashboard');
      expect(dashboard.comparisonValue).toBe('prev-day');

      // Reports opens on month-to-date → a month shape → prev-month.
      await harness.navigateByUrl('/reports');
      await flush();
      const reports = harness.routeDebugElement!.injector.get(TimeframeService);
      expect(reports).not.toBe(dashboard);
      expect(reports.comparisonValue).toBe('prev-month');
    });

    it('neither host writes cmp to the URL at its default', async () => {
      await bootAt('/dashboard');
      expect(queryOf()['cmp']).toBeUndefined();

      await harness.navigateByUrl('/reports');
      await flush();
      expect(queryOf()['cmp']).toBeUndefined();
    });

    it('holds INDEPENDENT seeds — a Reports choice never reaches the Dashboard', async () => {
      const reports = await bootAt('/reports');
      reports.setComparison('dates-last-year');
      await flush();

      expect(setItem).toHaveBeenCalledWith(REPORTS_CMP_KEY, 'dates-last-year');
      expect(setItem).not.toHaveBeenCalledWith(DASHBOARD_CMP_KEY, jasmine.anything());

      // …and the Dashboard, entered afterwards, still lands on its own default.
      await harness.navigateByUrl('/dashboard');
      await flush();
      expect(harness.routeDebugElement!.injector.get(TimeframeService).comparisonValue).toBe(
        'prev-day',
      );
    });

    it('a seeded Dashboard basis never leaks into Reports', async () => {
      stored[DASHBOARD_CMP_KEY] = 'dates-last-year';
      expect((await bootAt('/reports')).comparisonValue).toBe('prev-month');
    });

    it('a non-default cmp does not follow you onto a route with no timeframe', async () => {
      const reports = await bootAt('/reports');
      reports.setComparison('dates-last-year');
      await flush();
      expect(queryOf()['cmp']).toBe('dates-last-year'); // in the URL while it applies…

      await harness.navigateByUrl('/menu');
      await flush();
      expect(queryOf()).toEqual({}); // …and gone the moment it does not

      await harness.navigateByUrl('/settings');
      await flush();
      expect(queryOf()).toEqual({});
    });

    // The Dashboard's service DOES parse a hand-crafted ?cmp= into state — inert and
    // intended. Nothing on the Dashboard can set a non-default, so cmp is never WRITTEN
    // to a Dashboard URL, and 02B activates state that is already being parsed. Adding
    // route-specific stripping to prevent this would be worse than the untidiness.
    it('parses a hand-crafted cmp on the Dashboard without rendering or republishing it', async () => {
      const service = await bootAt(`/dashboard?from=${today}&to=${today}&preset=today&cmp=prev-week`);

      expect(service.comparisonValue).toBe('prev-week'); // parsed, held, unrendered
      expect(queryOf()['cmp']).toBe('prev-week'); // left exactly as the URL had it
    });
  });
});
