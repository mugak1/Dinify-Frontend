import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { format } from 'date-fns';
import { firstValueFrom } from 'rxjs';

import { TimeframeService } from './timeframe.service';
import { TIMEFRAME_CONFIG } from './timeframe-config';
import { ReportDateRange, defaultRange } from './timeframe-range';
import { SALES_TRENDS_CAP_DAYS, resolveComparison, stepRange } from './timeframe-engine';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
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

    // The custom start is per-host too, suffixed `.cmpFrom` — Dashboard and Reports must be
    // able to hold DIFFERENT placed windows, exactly as they hold different ranges.
    it('keys the custom-window start per host, so the two never share one', async () => {
      const service = await bootWithConfig(
        '/anywhere?from=2026-05-01&to=2026-05-31&preset=custom',
        { seedKey: 'dashboard.timeframe', defaultPreset: 'today' },
      );

      service.setComparison('custom', '2026-02-01');
      await flush();

      expect(setItem).toHaveBeenCalledWith('dashboard.timeframe.cmpFrom:r1', '2026-02-01');
      expect(setItem).not.toHaveBeenCalledWith('reports.dateRange.cmpFrom:r1', jasmine.anything());
    });

    it('reads back only its OWN host seed, never the other host\'s', async () => {
      // A start placed on Reports must be invisible to the Dashboard.
      stored['reports.dateRange.cmpFrom:r1'] = '2026-02-01';

      const service = await bootWithConfig(
        '/anywhere?from=2026-05-01&to=2026-05-31&preset=custom&cmp=custom',
        { seedKey: 'dashboard.timeframe', defaultPreset: 'today' },
      );

      expect(service.comparisonValue).toBe('custom');
      expect(service.customComparisonFromValue).toBeNull();
    });
  });
  // ─── Comparison basis (TIMEFRAME-02A) ──────────────────────────────────────────────
  //
  // The seed key mirrors the range's, suffixed `.cmp`, so the two hosts keep independent
  // memories of the basis exactly as they do of the range.
  describe('comparison basis', () => {
    const CMP_KEY = 'reports.dateRange.cmp:r1';
    // A month-shaped range: `prev-month` is its default, `prev-year` a valid alternative,
    // `prev-day` not offered at all.
    const MONTH = 'from=2026-05-01&to=2026-05-31&preset=custom';

    it("lands on the shape's default and keeps `cmp` OUT of the URL", async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}`);

      expect(service.comparisonValue).toBe('prev-month-by-day');
      expect(queryOf(router)['cmp']).toBeUndefined();
    });

    it('adopts a shape-valid cmp from the URL and leaves the URL alone', async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}&cmp=prev-year-by-day`);

      expect(service.comparisonValue).toBe('prev-year-by-day');
      expect(queryOf(router)['cmp']).toBe('prev-year-by-day');
    });

    it('falls back and CORRECTS the URL for an unrecognised cmp', async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}&cmp=banana`);

      expect(service.comparisonValue).toBe('prev-month-by-day');
      expect(queryOf(router)['cmp']).toBeUndefined();
    });

    it('falls back and CORRECTS the URL for a cmp this shape does not offer', async () => {
      // 'prev-day' is a known token, but a month-shaped range never offers it.
      const { service, router } = await bootAt(`/reports?${MONTH}&cmp=prev-day`);

      expect(service.comparisonValue).toBe('prev-month-by-day');
      expect(queryOf(router)['cmp']).toBeUndefined();
    });

    // REPLACE, never push — the same rule the range writes under, and what stops the
    // period arrows burying the page the user arrived from.
    it('corrects a bad cmp by REPLACE, so Back still leaves the screen', async () => {
      const { router } = await bootAt(`/reports?${MONTH}&cmp=banana`);
      const location = TestBed.inject(Location);

      location.back();
      await flush();

      expect(location.path()).not.toContain('/reports');
    });

    it('writes a non-default cmp to the URL and persists it under the .cmp seed key', async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}`);

      service.setComparison('prev-year-by-day');
      await flush();

      expect(queryOf(router)['cmp']).toBe('prev-year-by-day');
      expect(setItem).toHaveBeenCalledWith(CMP_KEY, 'prev-year-by-day');
    });

    it('REMOVES cmp from the URL when the selection returns to the default', async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}&cmp=prev-year-by-day`);

      service.setComparison('prev-month-by-day');
      await flush();

      expect(queryOf(router)['cmp']).toBeUndefined();
      // …and the range params are untouched by the comparison write.
      expect(queryOf(router)['from']).toBe('2026-05-01');
    });

    it('seeds from localStorage when the URL names no basis', async () => {
      stored['reports.dateRange.cmp:r1'] = 'prev-year-by-day';

      const { service } = await bootAt(`/reports?${MONTH}`);

      expect(service.comparisonValue).toBe('prev-year-by-day');
    });

    // ── The ids 02C REMOVED (`prev-month`, and `prev-year` at month level) ────────────
    //
    // Both live in seeds written before the upgrade and in URLs already shared. Neither
    // needs new code to degrade correctly, which is exactly why it is worth pinning: the
    // graceful paths are the ones nobody notices breaking.
    it('falls back when a SEED holds an id that no longer exists', async () => {
      stored['reports.dateRange.cmp:r1'] = 'prev-month'; // removed in 02C

      const { service } = await bootAt(`/reports?${MONTH}`);

      // Rejected by the seed's own `validate`, so it never reaches the shape gate.
      expect(service.comparisonValue).toBe('prev-month-by-day');
    });

    it('falls back and CORRECTS the URL for an id that no longer exists', async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}&cmp=prev-month`);

      expect(service.comparisonValue).toBe('prev-month-by-day');
      expect(queryOf(router)['cmp']).toBeUndefined();
    });

    // `prev-year` is still a KNOWN token — it survives at day, week and year level — so
    // this exercises the shape gate rather than the parser, and by REPLACE, which the
    // unknown-token path already covers but this one did not.
    it('corrects a still-known id the month shape no longer offers, by REPLACE', async () => {
      const { service, router } = await bootAt(`/reports?${MONTH}&cmp=prev-year`);
      const location = TestBed.inject(Location);

      expect(service.comparisonValue).toBe('prev-month-by-day');
      expect(queryOf(router)['cmp']).toBeUndefined();

      location.back();
      await flush();
      expect(location.path()).not.toContain('/reports');
    });

    it('ignores a seeded basis the entry range does not offer', async () => {
      stored['reports.dateRange.cmp:r1'] = 'prev-day'; // not offered for a month
      const { service } = await bootAt(`/reports?${MONTH}`);
      expect(service.comparisonValue).toBe('prev-month-by-day');
    });
  });

  // The rule that separates this from the reference model, which resets to "No
  // comparison" on every calendar Apply — even when the selection was still valid — and
  // then tells you in its own docs to use the arrows instead.
  describe('comparison across a range change', () => {
    const MONTH = 'from=2026-05-01&to=2026-05-31&preset=custom';

    it('KEEPS a selection the new shape still offers (a calendar Apply, same shape)', async () => {
      const { service } = await bootAt(`/reports?${MONTH}&cmp=prev-year-by-day`);

      // Apply a different month — same shape, so the basis must survive.
      service.set({ preset: 'custom', from: '2026-04-01', to: '2026-04-30' });

      expect(service.comparisonValue).toBe('prev-year-by-day');
    });

    it('KEEPS a selection across an ARROW STEP, and recomputes the window for it', async () => {
      const { service } = await bootAt(`/reports?${MONTH}&cmp=prev-year-by-day`);
      const stepped = stepRange(service.value, -1, new Date(2026, 4, 15));

      service.set(stepped);

      expect(service.comparisonValue).toBe('prev-year-by-day');
      // The window follows the new range rather than staying pinned to the old one.
      expect(resolveComparison(service.value, service.comparisonValue)).not.toEqual(
        resolveComparison({ preset: 'custom', from: '2026-05-01', to: '2026-05-31' }, 'prev-year-by-day'),
      );
    });

    it("falls back to the NEW shape's default when the selection is no longer offered", async () => {
      const { service } = await bootAt(`/reports?${MONTH}&cmp=dates-last-year`);

      // Month → single day. 'dates-last-year' IS offered for a day, so pick a basis that
      // is not: switch to a year, whose only non-none option is 'prev-year'.
      service.set({ preset: 'custom', from: '2025-01-01', to: '2025-12-31' });

      expect(service.comparisonValue).toBe('prev-year');
    });

    it("never silently wipes an active comparison — the fallback is never 'none'", async () => {
      const { service } = await bootAt(`/reports?${MONTH}&cmp=dates-last-year`);
      service.set({ preset: 'custom', from: '2025-01-01', to: '2025-12-31' });
      expect(service.comparisonValue).not.toBe('none');
    });

    it("leaves 'none' as 'none' — an explicit opt-out is not overridden by a shape change", async () => {
      const { service } = await bootAt(`/reports?${MONTH}&cmp=none`);
      expect(service.comparisonValue).toBe('none');

      service.set({ preset: 'today', from: today, to: today });

      expect(service.comparisonValue).toBe('none');
    });
  });

  // ─── The basis describes the FETCHED window (TIMEFRAME-TIDY-00) ───────────────────
  //
  // The service half of the rule the picker spec states in full: classify and resolve
  // from the same window (02B). Three sites classify a user-supplied range —
  // `carryComparison`, `resolveComparisonFor` and `writeUrl` — and all three now read
  // `effectiveRange`.
  //
  // The last two MOVE TOGETHER by necessity, which is the one thing here that is not
  // merely tidiness: `writeUrl` omits `cmp` when it equals the shape's default, and
  // `resolveComparisonFor` re-derives that same default when the URL comes back in. Split
  // their windows and they can disagree about whether an OMITTED `cmp` meant the default,
  // which turns a clean shared link into a different selection on arrival.
  //
  // Unobservable at the real cap, and the lowered cap has to run `custom` → real shape
  // rather than the reverse — the picker spec carries the full explanation of why.
  describe('with the annual cap lowered so the two windows can diverge', () => {
    /** Four years ending on a year boundary: shape `custom`, span 1460, so it clamps. */
    const FOUR_YEARS = 'from=2022-01-01&to=2025-12-31&preset=custom';
    /** At a 364-day cap this clamps to 2025-01-01…2025-12-31 — a whole calendar `year`. */
    const LOWERED = 364;

    const realCap = SALES_TRENDS_CAP_DAYS.annual;
    afterEach(() => {
      SALES_TRENDS_CAP_DAYS.annual = realCap;
    });

    it("adopts the clamped window's default at entry, not the raw range's", async () => {
      SALES_TRENDS_CAP_DAYS.annual = LOWERED;

      const { service } = await bootAt(`/reports?${FOUR_YEARS}`);

      // Raw is `custom` (default 'prev-period'); the fetched window is a whole `year`.
      expect(service.comparisonValue).toBe('prev-year');
    });

    // Entry leaves a VALID URL alone, so the omission rule only shows on a write.
    it("omits cmp on write when it is the clamped window's default", async () => {
      SALES_TRENDS_CAP_DAYS.annual = LOWERED;

      const { service, router } = await bootAt(`/reports?${FOUR_YEARS}`);
      service.setComparison('prev-year');
      await flush();

      // 'prev-year' IS the default once clamped, so it is not worth a param. Classifying
      // the raw range here would call it non-default — the raw shape is `custom`, whose
      // default is 'prev-period' — and publish `cmp=prev-year` into every shared link.
      expect(queryOf(router)['cmp']).toBeUndefined();
    });

    it('carries a basis across set() using the clamped shape', async () => {
      SALES_TRENDS_CAP_DAYS.annual = LOWERED;
      const { service } = await bootAt(`/reports?${FOUR_YEARS}`);
      expect(service.comparisonValue).toBe('prev-year');

      // Another over-cap range clamping onto a year boundary (2023 is not a leap year), so
      // the shape is unchanged and the basis must survive.
      service.set({ preset: 'custom', from: '2020-01-01', to: '2023-12-31' });

      expect(service.comparisonValue).toBe('prev-year');
    });

    it('leaves the same range on the raw shape while it is under the cap', async () => {
      const { service, router } = await bootAt(`/reports?${FOUR_YEARS}`);

      // Nothing clamps at the real 1850-day cap, so this is ordinary `custom` behaviour —
      // the invariance half, proving the change is invisible in normal use.
      expect(service.comparisonValue).toBe('prev-period');
      expect(queryOf(router)['cmp']).toBeUndefined();
    });
  });

  // ─── A user-placed comparison window (TIMEFRAME-02D) ─────────────────────────────
  //
  // Only the START is state, anywhere: the URL, the seed, and the service all carry one
  // date. Every assertion below is really the same claim from a different angle — that the
  // end is DERIVED, so nothing can ever rewrite a bound the user chose.
  describe('custom comparison window', () => {
    const CMP_FROM_KEY = 'reports.dateRange.cmpFrom:r1';
    /** May 2026 — 31 inclusive days, so a valid start must end before 1 May. */
    const MAY = 'from=2026-05-01&to=2026-05-31&preset=custom';

    it('adopts cmpFrom from the URL and derives an equal-length window', async () => {
      const { service, router } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-03-01`);

      expect(service.comparisonValue).toBe('custom');
      expect(service.customComparisonFromValue).toBe('2026-03-01');
      expect(queryOf(router)['cmpFrom']).toBe('2026-03-01');
      // 31 days from 1 Mar is 1–31 Mar.
      expect(resolveComparison(service.value, 'custom', undefined, service.customComparisonFromValue))
        .toEqual({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });
    });

    it('writes cmp AND cmpFrom in ONE commit, and seeds the start', async () => {
      const { service, router } = await bootAt(`/reports?${MAY}`);

      service.setComparison('custom', '2026-02-01');
      await flush();

      expect(queryOf(router)['cmp']).toBe('custom');
      expect(queryOf(router)['cmpFrom']).toBe('2026-02-01');
      expect(setItem).toHaveBeenCalledWith(CMP_FROM_KEY, '2026-02-01');
    });

    it('STRIPS cmpFrom from the URL when the basis moves away', async () => {
      const { service, router } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-03-01`);

      service.setComparison('prev-year-by-day');
      await flush();

      expect(queryOf(router)['cmp']).toBe('prev-year-by-day');
      expect(queryOf(router)['cmpFrom']).toBeUndefined();
    });

    it('RESTORES the placed start when the basis comes back to custom', async () => {
      // The seed is a memo, not a mirror of the URL — switching away and back must not
      // hand the user an empty calendar.
      const { service, router } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-03-01`);

      service.setComparison('prev-year-by-day');
      await flush();
      service.setComparison('custom');
      await flush();

      expect(service.customComparisonFromValue).toBe('2026-03-01');
      expect(queryOf(router)['cmpFrom']).toBe('2026-03-01');
    });

    it('drops an out-of-bounds cmpFrom and CORRECTS the URL by replace', async () => {
      // 15 May sits inside the range — the window would be partly self-referential.
      const { service, router } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-05-15`);

      expect(service.comparisonValue).toBe('custom');
      expect(service.customComparisonFromValue).toBeNull();
      expect(queryOf(router)['cmpFrom']).toBeUndefined();

      const location = TestBed.inject(Location);
      location.back();
      await flush();
      expect(location.path()).not.toContain('/reports');
    });

    it('drops an unreal cmpFrom without rejecting the range', async () => {
      const { service } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-02-31`);

      expect(service.value.from).toBe('2026-05-01');
      expect(service.customComparisonFromValue).toBeNull();
    });

    it('ignores cmpFrom entirely under any other basis', async () => {
      const { service, router } = await bootAt(
        `/reports?${MAY}&cmp=prev-year-by-day&cmpFrom=2026-03-01`,
      );

      expect(service.customComparisonFromValue).toBeNull();
      expect(queryOf(router)['cmpFrom']).toBeUndefined();
    });

    // THE CASE THAT WOULD HAVE FORCED A SILENT REWRITE had both bounds been stored. An
    // arrow step changes the range's LENGTH across a month boundary; the start is
    // untouched and the end simply re-derives.
    it('an arrow step keeps the START and re-derives the END across 31 → 30', async () => {
      const { service } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-03-01`);
      const before = resolveComparison(service.value, 'custom', undefined, '2026-03-01')!;
      expect(before).toEqual({ preset: 'custom', from: '2026-03-01', to: '2026-03-31' });

      // May (31 days) → April (30 days).
      service.set(stepRange(service.value, -1));
      await flush();

      expect(service.value).toEqual({ preset: 'custom', from: '2026-04-01', to: '2026-04-30' });
      expect(service.customComparisonFromValue).toBe('2026-03-01'); // untouched
      const after = resolveComparison(service.value, 'custom', undefined, '2026-03-01')!;
      expect(after.from).toBe('2026-03-01');
      expect(after.to).toBe('2026-03-30'); // one day shorter, derived — not rewritten
    });

    // `custom` is offered by every shape, so `carryComparison` always keeps it. Nothing in
    // the service does this explicitly; it falls out of the option sets, and this pins it.
    it('SURVIVES a shape change, re-deriving against the new length', async () => {
      const { service } = await bootAt(`/reports?${MAY}&cmp=custom&cmpFrom=2026-03-01`);

      service.set({ preset: 'today', from: today, to: today }); // month → day
      await flush();

      expect(service.comparisonValue).toBe('custom');
      expect(service.customComparisonFromValue).toBe('2026-03-01');
      // A single-day range means a single-day comparison.
      const w = resolveComparison(service.value, 'custom', undefined, '2026-03-01')!;
      expect(w).toEqual({ preset: 'custom', from: '2026-03-01', to: '2026-03-01' });
    });

    // An unplaced custom basis is a comparison not yet made, not an error state.
    it("resolves to null with no start — the same path 'none' takes", async () => {
      const { service } = await bootAt(`/reports?${MAY}&cmp=custom`);

      expect(service.comparisonValue).toBe('custom');
      expect(service.customComparisonFromValue).toBeNull();
      expect(
        resolveComparison(service.value, 'custom', undefined, service.customComparisonFromValue),
      ).toBeNull();
    });
  });
});
