// Shared timeframe state — THE URL IS THE SOURCE OF TRUTH.
//
// Owns the active `ReportDateRange` and the active COMPARISON BASIS for whichever route
// subtree provides it. Both live in the query string (`?from&to&preset&cmp`), which is
// what makes a report view shareable as a link and lets the timeframe survive a tab
// switch. localStorage is demoted to a per-restaurant "last used" SEED — see `seed` below.
//
// `cmp` is omitted whenever the basis is the current shape's default, so a URL only
// carries it when the user actually chose something. The basis is re-evaluated whenever
// the range changes shape (see `carryComparison`) — kept when the new shape still offers
// it, otherwise moved to that shape's default, and never silently wiped.
//
// SCOPE. This service is deliberately NOT `providedIn: 'root'`. It is registered on
// each host ROUTE (`providers: [TimeframeService, {provide: TIMEFRAME_CONFIG, …}]` in
// restaurant-mgt.module), so it exists only while that subtree is active and cannot
// stamp `?from=…&to=…` onto the URL of a page that has no timeframe. Route `providers`
// create an EnvironmentInjector for the subtree, so a shell and its routed children
// resolve the SAME instance. There are TWO hosts as of 01B — the Reports shell and the
// Dashboard — and each got there by adding a route registration, not by switching this
// to root. A third host is the same move again.
//
// PER-HOST CONFIG. The seed key and the landing preset come from `TIMEFRAME_CONFIG`
// (see timeframe-config.ts) rather than being hardcoded here: two hosts must not share
// a "last used" memo, and they land on different defaults.
//
// REPLACE, NEVER PUSH. Every timeframe write navigates with `replaceUrl: true`. Once
// the period-stepping arrows land (01C), pushing would put twenty history entries
// between the user and the page they arrived from; replacing keeps browser-back
// meaning "leave this screen". This is a deliberate and reversible call — if it tests
// badly, flipping `replaceUrl` here is the whole change.
//
// PARAM VOCABULARY. `from` / `to` rather than `start` / `end`, matching the names the
// API layer already uses — one vocabulary, not two.

import { Inject, Injectable } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { PersistedBehaviorSubject } from '../../_services/storage/persisted-state';
import { COMPARISON_OPTIONS, ComparisonOption } from './comparison-option';
import { TIMEFRAME_CONFIG, TimeframeConfig } from './timeframe-config';
import {
  classifyRangeShape,
  defaultComparisonFor,
  isComparisonOfferedFor,
} from './timeframe-engine';
import {
  ParsedTimeframe,
  ReportDateRange,
  ReportPreset,
  isFutureDated,
  isValidReportDateRange,
  parseTimeframeParams,
  presetToRange,
} from './timeframe-range';

const rangesEqual = (a: ReportDateRange, b: ReportDateRange): boolean =>
  a.preset === b.preset && a.from === b.from && a.to === b.to;

const isComparisonOption = (v: unknown): v is ComparisonOption =>
  typeof v === 'string' && COMPARISON_OPTIONS.includes(v as ComparisonOption);

@Injectable()
export class TimeframeService {
  /**
   * Per-restaurant "LAST USED" MEMO — **not** the source of truth. The URL is.
   *
   * Its only jobs are to remember a range across visits so a bare `/reports` link
   * lands somewhere sensible, and to be re-written whenever the URL supplies a range.
   * Anything that reads this to decide the CURRENT timeframe is a bug: read `range$`.
   *
   * `PersistedBehaviorSubject` reads its seed once at construction; because this
   * service is route-scoped, that happens on each entry to Reports rather than once
   * per app session, so a mid-session restaurant switch picks up the right key.
   */
  private readonly seed: PersistedBehaviorSubject<ReportDateRange>;

  /**
   * The comparison basis' own "last used" memo, keyed `<seedKey>.cmp:<restaurantId>`.
   *
   * A SEPARATE entry rather than a field widened onto the range seed: widening would
   * make every previously-stored range fail `isValidReportDateRange` — or, worse, pass
   * it while carrying no basis — and force the range validator to reason about
   * comparison state it has nothing to do with.
   */
  private readonly comparisonSeed: PersistedBehaviorSubject<ComparisonOption>;

  private readonly _range$: BehaviorSubject<ReportDateRange>;

  private readonly _comparison$: BehaviorSubject<ComparisonOption>;

  /** This host's landing preset. Read once from `TIMEFRAME_CONFIG`; `resolveOnEntry`
   *  runs from the constructor body, so it must be assigned before that call. */
  private readonly defaultPreset: Exclude<ReportPreset, 'custom'>;

  /** The active range. Shape-compatible with the `dateRange$` it replaced: emits the
   *  current value on subscribe, so `combineLatest` consumers need no other change. */
  readonly range$: Observable<ReportDateRange>;

  /**
   * The active comparison basis (TIMEFRAME-02A). Same shape as `range$` — emits on
   * subscribe — so a report tab can drop it straight into its existing `combineLatest`.
   *
   * Registered on BOTH hosts because the state belongs beside the range, but only
   * Reports renders a control for it today; on the Dashboard it sits at its default and
   * nothing reads it until 02B.
   */
  readonly comparison$: Observable<ComparisonOption>;

  constructor(
    private router: Router,
    localStorage: LocalStorageService,
    auth: AuthenticationService,
    @Inject(TIMEFRAME_CONFIG) config: TimeframeConfig,
  ) {
    this.defaultPreset = config.defaultPreset;

    // ORDER MATTERS in this constructor. `resolveOnEntry()` runs from the body below and
    // reads BOTH seeds, so both must exist first; and it runs before `_range$` /
    // `_comparison$` are assigned, so it must be handed everything it needs rather than
    // reading current state.
    this.seed = new PersistedBehaviorSubject<ReportDateRange>(this.hostDefault(), {
      storage: localStorage,
      getKey: () => `${config.seedKey}:${auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: isValidReportDateRange,
    });

    this.comparisonSeed = new PersistedBehaviorSubject<ComparisonOption>(
      defaultComparisonFor(classifyRangeShape(this.hostDefault())),
      {
        storage: localStorage,
        getKey: () =>
          `${config.seedKey}.cmp:${auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
        validate: isComparisonOption,
      },
    );

    const entry = this.resolveOnEntry();
    this._range$ = new BehaviorSubject<ReportDateRange>(entry.range);
    this._comparison$ = new BehaviorSubject<ComparisonOption>(entry.comparison);
    this.range$ = this._range$.asObservable();
    this.comparison$ = this._comparison$.asObservable();
    if (entry.writeSeed) this.seed.next(entry.range);
    if (entry.writeComparisonSeed) this.comparisonSeed.next(entry.comparison);
    if (entry.writeUrl) {
      // DEFERRED ON PURPOSE. This service is constructed DURING route activation, so the
      // navigation that brought us here is still in flight — navigating synchronously
      // here would re-enter the router mid-cycle and the correction would race (or be
      // cancelled by) the navigation still completing. A microtask puts the URL fixup
      // after the current cycle, where it is an ordinary same-route query-param replace.
      // Only the ENTRY correction needs this; `set()` is user-initiated and already idle.
      void Promise.resolve().then(() => this.writeUrl(entry.range, entry.comparison));
    }

    // Follow LATER URL changes — browser back/forward, and any in-app link that
    // carries its own range. Adoption never navigates (see adoptFromUrl), so the
    // one-time correction above cannot turn into a write→read→write loop.
    this.router.routerState.root.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((pm) => this.adoptFromUrl(pm));
  }

  /** Current range, for callers that need it synchronously. */
  get value(): ReportDateRange {
    return this._range$.value;
  }

  /** Current comparison basis, for callers that need it synchronously. */
  get comparisonValue(): ComparisonOption {
    return this._comparison$.value;
  }

  /** This host's landing range. Was `defaultRange()` before the config token — which
   *  is literally `presetToRange('this-month')`, so Reports is unchanged. */
  private hostDefault(): ReportDateRange {
    return presetToRange(this.defaultPreset);
  }

  /**
   * Commit a new timeframe. Writes the seed, emits optimistically, then puts the range
   * in the URL. The optimistic emit preserves the synchronous-on-write semantics the
   * four report tabs' `combineLatest` chains were built against — waiting for the
   * router round-trip would show a frame of stale data.
   *
   * A range change can change the range's SHAPE, and shape decides which comparison
   * bases are on offer — so the selection is re-evaluated here (see `carryComparison`)
   * and both are published to the URL in ONE navigation. Two navigations would leave a
   * frame where `cmp` names a basis the range no longer offers.
   */
  set(range: ReportDateRange): void {
    const comparison = this.carryComparison(range);
    this.seed.next(range);
    this._range$.next(range);
    if (comparison !== this._comparison$.value) {
      this.comparisonSeed.next(comparison);
      this._comparison$.next(comparison);
    }
    this.writeUrl(range, comparison);
  }

  /** Commit a new comparison basis. Mirrors `set()`; the range is untouched. */
  setComparison(option: ComparisonOption): void {
    this.comparisonSeed.next(option);
    this._comparison$.next(option);
    this.writeUrl(this._range$.value, option);
  }

  /**
   * The comparison basis to carry into `range`, given the one held now:
   *   - offered by the new shape → KEPT;
   *   - not offered, and not `'none'` → the new shape's default;
   *   - `'none'` → stays `'none'`.
   *
   * NEVER SILENTLY WIPE AN ACTIVE COMPARISON. The reference model resets to "No
   * comparison" on every calendar Apply even when the selection would still have been
   * valid, which is why its own documentation tells you to use the arrows instead — a
   * workaround for a defect. Here the selection survives both.
   *
   * The `'none'` branch is belt-and-braces: `'none'` is in every option set, so the
   * "not offered" test can never catch it. Stating it anyway keeps the rule readable as
   * the three cases it is, rather than as an accident of set membership.
   */
  private carryComparison(range: ReportDateRange): ComparisonOption {
    const current = this._comparison$.value;
    if (current === 'none') return 'none';
    const shape = classifyRangeShape(range);
    return isComparisonOfferedFor(shape, current) ? current : defaultComparisonFor(shape);
  }

  /**
   * Entry resolution, in priority order:
   *   1. Valid URL params  → authoritative. Refresh the seed; leave the URL alone.
   *   2. Usable seed       → adopt it and publish it to the URL.
   *   3. Neither           → this host's `defaultPreset`, published to the URL.
   *
   * The seed gets a `isFutureDated` check the URL path already applies: a stale entry
   * written before in-progress presets were clamped (e.g. `to: 2026-07-31` saved mid-
   * July) is future-dated, so it falls through to the corrected default rather than
   * resurrecting a range the app would no longer produce.
   *
   * The comparison basis follows the same ladder against whichever range won — URL,
   * then seed, then the shape's default — but with the extra gate that a basis must be
   * OFFERED for that range's shape. `parseTimeframeParams` can only tell us the token is
   * known; shape-validity is ours because only we hold the range.
   */
  private resolveOnEntry(): {
    range: ReportDateRange;
    comparison: ComparisonOption;
    writeUrl: boolean;
    writeSeed: boolean;
    writeComparisonSeed: boolean;
  } {
    const pm = this.router.routerState.snapshot.root.queryParamMap;
    const fromUrl = this.readUrl(pm);

    if (fromUrl) {
      // An authoritative URL is normally left EXACTLY as the sharer wrote it. The one
      // exception is a param we had to coerce — a preset (absent or unrecognised →
      // 'custom'), or a `cmp` that is unknown or not offered for this range's shape.
      // There the URL no longer describes the state we adopted, so leaving it would
      // publish a link that means one thing and renders another. Normalise it.
      const comparison = this.resolveComparisonFor(fromUrl.range, fromUrl.comparison);
      const coercedPreset = pm.get('preset') !== fromUrl.range.preset;
      const coercedCmp = pm.get('cmp') !== null && pm.get('cmp') !== comparison;
      return {
        range: fromUrl.range,
        comparison,
        writeUrl: coercedPreset || coercedCmp,
        writeSeed: true,
        writeComparisonSeed: true,
      };
    }

    const seeded = this.seed.value;
    if (isValidReportDateRange(seeded) && !isFutureDated(seeded)) {
      return {
        range: seeded,
        comparison: this.resolveComparisonFor(seeded, null),
        writeUrl: true,
        writeSeed: false,
        writeComparisonSeed: false,
      };
    }

    const fallback = this.hostDefault();
    return {
      range: fallback,
      comparison: this.resolveComparisonFor(fallback, null),
      writeUrl: true,
      writeSeed: true,
      writeComparisonSeed: true,
    };
  }

  /**
   * The basis to adopt for `range`: the URL's if it is offered for this shape, else the
   * seed's if that is, else the shape's default. Used only at entry — once state exists,
   * `carryComparison` takes over, because then there is a live selection to preserve
   * rather than a stored one to adopt.
   */
  private resolveComparisonFor(
    range: ReportDateRange,
    fromUrl: ComparisonOption | null,
  ): ComparisonOption {
    const shape = classifyRangeShape(range);
    if (fromUrl && isComparisonOfferedFor(shape, fromUrl)) return fromUrl;
    const seeded = this.comparisonSeed.value;
    if (isComparisonOption(seeded) && isComparisonOfferedFor(shape, seeded)) return seeded;
    return defaultComparisonFor(shape);
  }

  /**
   * Adopt what the URL now carries — browser back/forward, or an in-app link with its
   * own params. Deliberately inert on absent/invalid params: it holds current state
   * rather than navigating, so this can never fight `set()`.
   *
   * Both the range AND the basis are checked. An early return on an equal range would
   * swallow a `cmp`-only change, which is exactly what stepping back through history
   * over a comparison switch produces.
   */
  private adoptFromUrl(pm: ParamMap): void {
    const parsed = this.readUrl(pm);
    if (!parsed) return;

    const rangeChanged = !rangesEqual(parsed.range, this._range$.value);
    // Re-resolve against the incoming range, since a `cmp` valid for the old shape need
    // not be valid for the new one. Inert: the correction is not published, so the URL
    // stays authoritative until the next `set()` / `setComparison()`.
    const comparison = this.resolveComparisonFor(parsed.range, parsed.comparison);
    const comparisonChanged = comparison !== this._comparison$.value;
    if (!rangeChanged && !comparisonChanged) return;

    if (rangeChanged) {
      this.seed.next(parsed.range);
      this._range$.next(parsed.range);
    }
    if (comparisonChanged) {
      this.comparisonSeed.next(comparison);
      this._comparison$.next(comparison);
    }
  }

  private readUrl(pm: ParamMap): ParsedTimeframe | null {
    return parseTimeframeParams({
      from: pm.get('from'),
      to: pm.get('to'),
      preset: pm.get('preset'),
      cmp: pm.get('cmp'),
    });
  }

  /**
   * The empty commands array is deliberate: `createUrlTree` short-circuits on
   * `commands.length === 0` and keeps the current segment tree, replacing only the
   * query string. Do NOT "fix" this by adding `relativeTo` — that resolves against the
   * root and would navigate away from the active report.
   */
  private writeUrl(range: ReportDateRange, comparison: ComparisonOption): void {
    // `cmp` is OMITTED at the shape's default, so ordinary URLs stay as clean as they
    // were before 02A and only a deliberate choice shows up in a shared link. `null` is
    // how you remove a param under `queryParamsHandling: 'merge'` — dropping the key
    // instead would leave a stale value behind on a range that no longer offers it.
    const isDefault = comparison === defaultComparisonFor(classifyRangeShape(range));
    this.router
      .navigate([], {
        queryParams: {
          from: range.from,
          to: range.to,
          preset: range.preset,
          cmp: isDefault ? null : comparison,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      // Publishing to the URL is best-effort, exactly like the localStorage seed: the
      // range has already been emitted, so a rejected navigation (a guard, a teardown
      // mid-flight) must not surface as an unhandled rejection or break the view.
      .catch((e) => console.warn('[TimeframeService] could not publish the range to the URL', e));
  }
}
