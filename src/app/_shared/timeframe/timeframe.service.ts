// Shared timeframe state — THE URL IS THE SOURCE OF TRUTH.
//
// Owns the active `ReportDateRange` for whichever route subtree provides it. The
// range lives in the query string (`?from&to&preset`), which is what makes a report
// view shareable as a link and lets the timeframe survive a tab switch. localStorage
// is demoted to a per-restaurant "last used" SEED — see `seed` below.
//
// SCOPE. This service is deliberately NOT `providedIn: 'root'`. It is registered on
// the Reports parent route (`providers: [TimeframeService]` in restaurant-mgt.module),
// so it exists only while that subtree is active and cannot stamp `?from=…&to=…` onto
// the URL of a page that has no timeframe. Route `providers` create an
// EnvironmentInjector for the subtree, so the shell and all four routed children
// resolve the SAME instance. Adding a second host (01B's Dashboard) means adding a
// second route registration, not switching this to root.
//
// REPLACE, NEVER PUSH. Every timeframe write navigates with `replaceUrl: true`. Once
// the period-stepping arrows land (01C), pushing would put twenty history entries
// between the user and the page they arrived from; replacing keeps browser-back
// meaning "leave this screen". This is a deliberate and reversible call — if it tests
// badly, flipping `replaceUrl` here is the whole change.
//
// PARAM VOCABULARY. `from` / `to` rather than `start` / `end`, matching the names the
// API layer already uses — one vocabulary, not two.

import { Injectable } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { PersistedBehaviorSubject } from '../../_services/storage/persisted-state';
import {
  ReportDateRange,
  defaultRange,
  isFutureDated,
  isValidReportDateRange,
  parseTimeframeParams,
} from './timeframe-range';

const rangesEqual = (a: ReportDateRange, b: ReportDateRange): boolean =>
  a.preset === b.preset && a.from === b.from && a.to === b.to;

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

  private readonly _range$: BehaviorSubject<ReportDateRange>;

  /** The active range. Shape-compatible with the `dateRange$` it replaced: emits the
   *  current value on subscribe, so `combineLatest` consumers need no other change. */
  readonly range$: Observable<ReportDateRange>;

  constructor(
    private router: Router,
    localStorage: LocalStorageService,
    auth: AuthenticationService,
  ) {
    this.seed = new PersistedBehaviorSubject<ReportDateRange>(defaultRange(), {
      storage: localStorage,
      getKey: () => `reports.dateRange:${auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: isValidReportDateRange,
    });

    const entry = this.resolveOnEntry();
    this._range$ = new BehaviorSubject<ReportDateRange>(entry.range);
    this.range$ = this._range$.asObservable();
    if (entry.writeSeed) this.seed.next(entry.range);
    if (entry.writeUrl) {
      // DEFERRED ON PURPOSE. This service is constructed DURING route activation, so the
      // navigation that brought us here is still in flight — navigating synchronously
      // here would re-enter the router mid-cycle and the correction would race (or be
      // cancelled by) the navigation still completing. A microtask puts the URL fixup
      // after the current cycle, where it is an ordinary same-route query-param replace.
      // Only the ENTRY correction needs this; `set()` is user-initiated and already idle.
      void Promise.resolve().then(() => this.writeUrl(entry.range));
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

  /**
   * Commit a new timeframe. Writes the seed, emits optimistically, then puts the range
   * in the URL. The optimistic emit preserves the synchronous-on-write semantics the
   * four report tabs' `combineLatest` chains were built against — waiting for the
   * router round-trip would show a frame of stale data.
   */
  set(range: ReportDateRange): void {
    this.seed.next(range);
    this._range$.next(range);
    this.writeUrl(range);
  }

  /**
   * Entry resolution, in priority order:
   *   1. Valid URL params  → authoritative. Refresh the seed; leave the URL alone.
   *   2. Usable seed       → adopt it and publish it to the URL.
   *   3. Neither           → `defaultRange()`, published to the URL.
   *
   * The seed gets a `isFutureDated` check the URL path already applies: a stale entry
   * written before in-progress presets were clamped (e.g. `to: 2026-07-31` saved mid-
   * July) is future-dated, so it falls through to the corrected default rather than
   * resurrecting a range the app would no longer produce.
   */
  private resolveOnEntry(): { range: ReportDateRange; writeUrl: boolean; writeSeed: boolean } {
    const pm = this.router.routerState.snapshot.root.queryParamMap;
    const fromUrl = this.readUrl(pm);
    if (fromUrl) {
      // An authoritative URL is normally left EXACTLY as the sharer wrote it. The one
      // exception is a preset we had to coerce (absent or unrecognised → 'custom'):
      // there the URL no longer describes the state we adopted, so leaving it would
      // publish a link that means one thing and renders another. Normalise it.
      const coerced = pm.get('preset') !== fromUrl.preset;
      return { range: fromUrl, writeUrl: coerced, writeSeed: true };
    }

    const seeded = this.seed.value;
    if (isValidReportDateRange(seeded) && !isFutureDated(seeded)) {
      return { range: seeded, writeUrl: true, writeSeed: false };
    }

    return { range: defaultRange(), writeUrl: true, writeSeed: true };
  }

  /** Adopt a range the URL now carries. Deliberately inert on absent/invalid params —
   *  it holds current state rather than navigating, so this can never fight `set()`. */
  private adoptFromUrl(pm: ParamMap): void {
    const parsed = this.readUrl(pm);
    if (!parsed || rangesEqual(parsed, this._range$.value)) return;
    this.seed.next(parsed);
    this._range$.next(parsed);
  }

  private readUrl(pm: ParamMap): ReportDateRange | null {
    return parseTimeframeParams({
      from: pm.get('from'),
      to: pm.get('to'),
      preset: pm.get('preset'),
    });
  }

  /**
   * The empty commands array is deliberate: `createUrlTree` short-circuits on
   * `commands.length === 0` and keeps the current segment tree, replacing only the
   * query string. Do NOT "fix" this by adding `relativeTo` — that resolves against the
   * root and would navigate away from the active report.
   */
  private writeUrl(range: ReportDateRange): void {
    this.router
      .navigate([], {
        queryParams: { from: range.from, to: range.to, preset: range.preset },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      // Publishing to the URL is best-effort, exactly like the localStorage seed: the
      // range has already been emitted, so a rejected navigation (a guard, a teardown
      // mid-flight) must not surface as an unhandled rejection or break the view.
      .catch((e) => console.warn('[TimeframeService] could not publish the range to the URL', e));
  }
}
