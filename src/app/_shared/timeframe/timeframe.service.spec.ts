import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { format } from 'date-fns';
import { firstValueFrom } from 'rxjs';

import { TimeframeService } from './timeframe.service';
import { TIMEFRAME_CONFIG } from './timeframe-config';
import { ReportDateRange, defaultRange } from './timeframe-range';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';

@Component({ standalone: true, template: '' })
class HostComponent {}

const SEED_KEY = 'reports.dateRange:r1';
const today = format(new Date(), 'yyyy-MM-dd');

describe('TimeframeService — the URL is the source of truth', () => {
  let stored: Record<string, unknown>;
  let setItem: jasmine.Spy;

  /** Boots the service under a real router at `url`, exactly as the Reports route does:
   *  registered on the route, so it is created when that subtree activates. */
  async function bootAt(url: string): Promise<{ service: TimeframeService; router: Router }> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'reports',
            component: HostComponent,
            // Register the config exactly as the production route does. The token has a
            // root default, but it is deliberately NEUTRAL — leaning on it here would
            // test a fallback no host actually uses.
            providers: [
              TimeframeService,
              {
                provide: TIMEFRAME_CONFIG,
                useValue: { seedKey: 'reports.dateRange', defaultPreset: 'this-month' },
              },
            ],
          },
          { path: 'elsewhere', component: HostComponent },
        ]),
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        {
          provide: LocalStorageService,
          useValue: {
            getItem: (k: string) => stored[k] ?? null,
            setItem,
          },
        },
      ],
    });

    const harness = await RouterTestingHarness.create(url);
    const router = TestBed.inject(Router);
    // Resolve from the activated route's injector — the same place the shell and the
    // four report children resolve it from.
    const service = harness.routeDebugElement!.injector.get(TimeframeService);
    // The entry URL correction is deferred past the activating navigation (see the
    // service), so let it land before asserting on the URL.
    await flush();
    return { service, router };
  }

  /** Let the deferred URL write, and the navigation it starts, complete. */
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  const queryOf = (router: Router): Record<string, string> =>
    Object.fromEntries(new URL(router.url, 'http://x').searchParams.entries());

  beforeEach(() => {
    stored = {};
    setItem = jasmine.createSpy('setItem').and.callFake((k: string, v: unknown) => {
      stored[k] = v;
    });
  });

  describe('entry resolution', () => {
    it('adopts valid URL params verbatim, seeds them, and leaves the URL alone', async () => {
      const { service, router } = await bootAt(
        '/reports?from=2026-05-01&to=2026-05-31&preset=custom',
      );

      expect(service.value).toEqual({ preset: 'custom', from: '2026-05-01', to: '2026-05-31' });
      // The URL was already authoritative — nothing rewritten.
      expect(router.url).toBe('/reports?from=2026-05-01&to=2026-05-31&preset=custom');
      // …but the seed learns from it.
      expect(setItem).toHaveBeenCalledWith(SEED_KEY, service.value);
    });

    it('carries an explicit preset rather than re-deriving it from the dates', async () => {
      // Same dates, different preset → different range. The preset is metadata that
      // survives the round-trip; deriving it would collapse these two into one.
      const { service } = await bootAt('/reports?from=2026-05-01&to=2026-05-31&preset=last-month');
      expect(service.value.preset).toBe('last-month');
    });

    it('adopts the seed and publishes it to the URL when params are absent', async () => {
      const seeded: ReportDateRange = { preset: 'custom', from: '2026-04-01', to: '2026-04-30' };
      stored[SEED_KEY] = seeded;

      const { service, router } = await bootAt('/reports');

      expect(service.value).toEqual(seeded);
      expect(queryOf(router)).toEqual({ from: '2026-04-01', to: '2026-04-30', preset: 'custom' });
    });

    it('ignores an incomplete param pair and falls through to the seed', async () => {
      stored[SEED_KEY] = { preset: 'custom', from: '2026-04-01', to: '2026-04-30' };

      const { service } = await bootAt('/reports?from=2026-05-01'); // no `to`

      expect(service.value.from).toBe('2026-04-01');
    });

    it('falls back to defaultRange when there is neither a URL nor a seed', async () => {
      const { service, router } = await bootAt('/reports');

      expect(service.value).toEqual(defaultRange());
      expect(queryOf(router)).toEqual({
        from: service.value.from,
        to: service.value.to,
        preset: 'this-month',
      });
    });

    it('discards a stale future-dated seed rather than resurrecting it', async () => {
      // Written before in-progress presets were clamped to today: a month-end `to`.
      stored[SEED_KEY] = { preset: 'this-month', from: '2999-01-01', to: '2999-01-31' };

      const { service } = await bootAt('/reports');

      expect(service.value).toEqual(defaultRange());
      expect(service.value.to).toBe(today);
    });
  });

  describe('malformed URLs degrade gracefully', () => {
    const SEED: ReportDateRange = { preset: 'custom', from: '2026-04-01', to: '2026-04-30' };

    const cases: Array<[string, string]> = [
      ['inverted range', 'from=2026-06-10&to=2026-06-01&preset=custom'],
      ['unparseable date', 'from=2026-13-45&to=2026-06-15&preset=custom'],
      ['non-existent calendar date', 'from=2026-02-31&to=2026-06-15&preset=custom'],
      ['future `to`', 'from=2026-01-01&to=2999-01-01&preset=custom'],
    ];

    for (const [label, qs] of cases) {
      it(`falls back to the seed and corrects the URL — ${label}`, async () => {
        stored[SEED_KEY] = SEED;

        let boot!: { service: TimeframeService; router: Router };
        await expectAsync((async () => (boot = await bootAt(`/reports?${qs}`)))()).toBeResolved();

        expect(boot.service.value).toEqual(SEED);
        expect(queryOf(boot.router)).toEqual({
          from: '2026-04-01',
          to: '2026-04-30',
          preset: 'custom',
        });
      });
    }

    it('keeps an otherwise-valid range whose preset is unknown, coercing it to custom', async () => {
      const { service, router } = await bootAt(
        '/reports?from=2026-05-01&to=2026-05-31&preset=banana',
      );

      expect(service.value).toEqual({ preset: 'custom', from: '2026-05-01', to: '2026-05-31' });
      // The coercion changed what the URL means, so the URL is normalised to match —
      // otherwise re-sharing the link would publish `banana` and render `custom`.
      expect(queryOf(router)['preset']).toBe('custom');
    });

    it('normalises an omitted preset to custom in the URL too', async () => {
      const { service, router } = await bootAt('/reports?from=2026-05-01&to=2026-05-31');

      expect(service.value.preset).toBe('custom');
      expect(queryOf(router)['preset']).toBe('custom');
    });
  });

  describe('writes', () => {
    const NEXT: ReportDateRange = { preset: 'custom', from: '2026-03-01', to: '2026-03-31' };

    it('REPLACES rather than pushes, so browser-back still leaves the screen', async () => {
      const { service, router } = await bootAt(
        '/reports?from=2026-05-01&to=2026-05-31&preset=custom',
      );
      const navigate = spyOn(router, 'navigate').and.callThrough();

      service.set(NEXT);

      expect(navigate).toHaveBeenCalledTimes(1);
      const [commands, extras] = navigate.calls.mostRecent().args as [unknown[], Record<string, unknown>];
      expect(commands).toEqual([]); // empty commands keep the current segment tree
      expect(extras['replaceUrl']).toBeTrue();
      expect(extras['queryParamsHandling']).toBe('merge');
    });

    it('emits the new range synchronously, before the router settles', async () => {
      const { service } = await bootAt('/reports?from=2026-05-01&to=2026-05-31&preset=custom');

      const seen: ReportDateRange[] = [];
      service.range$.subscribe((r) => seen.push(r));
      service.set(NEXT);

      // Optimistic: the four report tabs' combineLatest chains see it immediately.
      expect(seen[seen.length - 1]).toEqual(NEXT);
      expect(service.value).toEqual(NEXT);
    });

    it('writes the seed and the URL', async () => {
      const { service, router } = await bootAt('/reports');
      service.set(NEXT);
      await flush();

      expect(stored[SEED_KEY]).toEqual(NEXT);
      expect(queryOf(router)).toEqual({ from: '2026-03-01', to: '2026-03-31', preset: 'custom' });
    });

    it('merges rather than clobbers unrelated query params', async () => {
      const { service, router } = await bootAt('/reports?tab=x');
      service.set(NEXT);
      await flush();

      expect(queryOf(router)['tab']).toBe('x');
      expect(queryOf(router)['from']).toBe('2026-03-01');
    });
  });

  describe('later URL changes', () => {
    it('adopts a range the URL gains (back/forward, in-app link)', async () => {
      const { service, router } = await bootAt(
        '/reports?from=2026-05-01&to=2026-05-31&preset=custom',
      );

      await router.navigate([], {
        queryParams: { from: '2026-02-01', to: '2026-02-28', preset: 'last-month' },
        queryParamsHandling: 'merge',
      });

      expect(service.value).toEqual({ preset: 'last-month', from: '2026-02-01', to: '2026-02-28' });
    });

    it('holds state when the URL loses its params instead of thrashing', async () => {
      const { service, router } = await bootAt(
        '/reports?from=2026-05-01&to=2026-05-31&preset=custom',
      );
      const before = service.value;

      await router.navigate([], { queryParams: {} }); // params dropped entirely

      expect(service.value).toEqual(before);
    });

    it('emits once per change — the URL echo of its own write is a no-op', async () => {
      const { service } = await bootAt('/reports?from=2026-05-01&to=2026-05-31&preset=custom');

      const seen: ReportDateRange[] = [];
      service.range$.subscribe((r) => seen.push(r));
      const baseline = seen.length; // BehaviorSubject replay

      service.set({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });
      await flush();

      expect(seen.length - baseline).toBe(1);
    });
  });

  it('exposes range$ with BehaviorSubject replay semantics', async () => {
    const { service } = await bootAt('/reports?from=2026-05-01&to=2026-05-31&preset=custom');
    await expectAsync(firstValueFrom(service.range$)).toBeResolvedTo(service.value);
  });

  // TIMEFRAME_CONFIG — the seed key and the landing preset are per HOST, so two hosts
  // can never inherit each other's "last used" range. Host-vs-host isolation through the
  // real router is pinned separately in restaurant-mgt/timeframe-host-isolation.spec.ts;
  // these cases pin that the service reads the token at all.
  describe('TIMEFRAME_CONFIG', () => {
    /** Boots at `url` with an explicit config, mirroring a production route. */
    async function bootWithConfig(
      url: string,
      config: { seedKey: string; defaultPreset: 'today' | 'this-month' },
    ): Promise<TimeframeService> {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([
            {
              path: 'anywhere',
              component: HostComponent,
              providers: [TimeframeService, { provide: TIMEFRAME_CONFIG, useValue: config }],
            },
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

      const harness = await RouterTestingHarness.create(url);
      const service = harness.routeDebugElement!.injector.get(TimeframeService);
      await flush();
      return service;
    }

    it('lands on the host default preset when neither URL nor seed supplies a range', async () => {
      const service = await bootWithConfig('/anywhere', {
        seedKey: 'dashboard.timeframe',
        defaultPreset: 'today',
      });

      expect(service.value.preset).toBe('today');
      expect(service.value.from).toBe(today);
      expect(service.value.to).toBe(today);
    });

    it('writes the seed under the host key, never a shared one', async () => {
      const service = await bootWithConfig('/anywhere', {
        seedKey: 'dashboard.timeframe',
        defaultPreset: 'today',
      });

      service.set({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });

      expect(setItem).toHaveBeenCalledWith('dashboard.timeframe:r1', jasmine.anything());
      // The whole point of the token: this host can never touch the Reports memo.
      expect(setItem).not.toHaveBeenCalledWith(SEED_KEY, jasmine.anything());
    });

    it('reads its seed from the host key', async () => {
      const seeded: ReportDateRange = { preset: 'custom', from: '2026-02-01', to: '2026-02-14' };
      stored['dashboard.timeframe:r1'] = seeded;

      const service = await bootWithConfig('/anywhere', {
        seedKey: 'dashboard.timeframe',
        defaultPreset: 'today',
      });

      expect(service.value).toEqual(seeded);
    });

    it("the reports config's landing range is exactly the pre-token defaultRange()", async () => {
      const service = await bootWithConfig('/anywhere', {
        seedKey: 'reports.dateRange',
        defaultPreset: 'this-month',
      });

      expect(service.value).toEqual(defaultRange());
    });
  });
});
