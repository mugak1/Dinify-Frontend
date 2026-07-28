import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { of, throwError } from 'rxjs';

import { MenuReportComponent } from './menu-report.component';
import { provideRouter } from '@angular/router';
import { ReportsService } from '../services/reports.service';
import { resolveTimeframe, TimeframeService } from '../../../_shared/timeframe';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { MenuService } from '../../menu/services/menu.service';

const MENU_ITEMS = [
  { available: true, in_stock: true },
  { available: true, in_stock: false }, // active but sold out
  { available: false, in_stock: true }, // hidden — not counted
];

describe('MenuReportComponent', () => {
  let component: MenuReportComponent;
  let fixture: ComponentFixture<MenuReportComponent>;
  let reports: ReportsService;
  let timeframe: TimeframeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MenuReportComponent],
      providers: [
        provideRouter([]),
        TimeframeService,
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']) },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' }, currentRestaurant: { name: 'Test' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
        { provide: MenuService, useValue: { loadAllItems: () => {}, allItems$: of(MENU_ITEMS as any) } },
      ],
    }).compileComponents();

    reports = TestBed.inject(ReportsService);

    timeframe = TestBed.inject(TimeframeService);
    fixture = TestBed.createComponent(MenuReportComponent);
    component = fixture.componentInstance;
  });

  it('loads aggregates + the point-in-time active-items count for the default range', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.items.length).toBeGreaterThan(0);
    expect(component.current.units).toBeGreaterThan(0);
    expect(component.previous).not.toBeNull(); // comparison window resolved
    // Active items come from the live menu, NOT the range summary.
    expect(component.activeCount).toBe(2);
    expect(component.outOfStockCount).toBe(1);
  }));

  it('re-fetches the category grouping when the toggle changes', fakeAsync(() => {
    const spy = spyOn(reports, 'getMenuSummary').and.callThrough();

    component.ngOnInit();
    tick(600);
    // The category fetch (last source) carries the selected grouping.
    expect(spy.calls.mostRecent().args[3]).toBe('sections');

    component.onGrouping('groups');
    tick(600);
    expect(spy.calls.mostRecent().args[3]).toBe('groups');
    expect(component.grouping).toBe('groups');
    expect(component.ready).toBeTrue();
  }));

  it('Full menu switches the grouping to items', fakeAsync(() => {
    component.ngOnInit();
    tick(600);

    component.showFullMenu();
    tick(600);

    expect(component.grouping).toBe('items');
    expect(component.ready).toBeTrue();
  }));

  it('renders at a range longer than 31 days (no listing guard for menu)', fakeAsync(() => {
    timeframe.set({ preset: 'custom', from: '2026-01-01', to: '2026-06-30' });

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeTrue();
    expect(component.items.length).toBeGreaterThan(0);
  }));

  it('shows the empty state when no rows are returned', fakeAsync(() => {
    spyOn(reports, 'getMenuSummary').and.returnValue(of({ data: [] } as any));

    component.ngOnInit();
    tick(600);

    expect(component.ready).toBeFalse();
    expect(component.state).toBe('empty');
  }));

  it('shows the error state and retry re-triggers a fetch', fakeAsync(() => {
    spyOn(reports, 'getMenuSummary').and.returnValue(throwError(() => new Error('boom')));

    component.ngOnInit();
    tick(600);

    expect(component.state).toBe('error');

    const refreshSpy = spyOn(reports.refresh$, 'next');
    component.retry();
    expect(refreshSpy).toHaveBeenCalled();
  }));
  // ─── Comparison basis (TIMEFRAME-02A) ──────────────────────────────────────────────
  //
  // Before 02A the comparison window was fetched on EVERY load regardless of the compare
  // toggle — wasted work then, indefensible once "No comparison" is a deliberate choice.
  // Driven through the LIVE pipeline (comparison$ is one of its inputs), which is how a
  // user actually flips the basis.
  describe('comparison basis', () => {
    it("issues NO comparison request while the basis is 'none', and one when it is not", fakeAsync(() => {
      const spy = spyOn(reports, 'getMenuSummary').and.callThrough();

      timeframe.setComparison('none');
      component.ngOnInit();
      tick(600);

      const withoutComparison = spy.calls.count();
      expect(component.previous).toBeNull();

      // Flip to a real basis on the same live pipeline: one MORE call, and a comparison.
      spy.calls.reset();
      timeframe.setComparison('prev-month-by-day');
      tick(600);

      expect(spy.calls.count()).toBeGreaterThan(withoutComparison);
      expect(component.previous).not.toBeNull();
    }));

    // An UNPLACED custom period issues no request either — it resolves to `null`, the exact
    // path `'none'` already takes, so the surface needs no branch of its own for it.
    it("issues NO comparison request for a 'custom' basis with no start placed", fakeAsync(() => {
      const spy = spyOn(reports, 'getMenuSummary').and.callThrough();

      timeframe.setComparison('none');
      component.ngOnInit();
      tick(600);
      const baseline = spy.calls.count();

      spy.calls.reset();
      timeframe.setComparison('custom'); // no start
      tick(600);

      expect(spy.calls.count()).toBe(baseline);
    }));
  });

  // ─── The comparison window spans the PRIMARY's window (REPORTS-COMPARISON-00) ──────
  //
  // The invariant is same-window-as-primary, NOT "use effectiveRange". This surface fetches
  // its primary UNCAPPED, over the raw range, so the raw range is the correct argument to
  // `resolveComparison` and it already satisfies the invariant. Sales differs only because
  // its primary is fetched over `effectiveRange`.
  //
  // This is a regression guard against tidying the four report tabs into agreement: switching
  // this one to `effectiveRange` for symmetry would set a clamped baseline beside an
  // unclamped primary and BREAK the invariant rather than spread it.
  describe('comparison window vs the primary window', () => {
    const OVER_CAP = { preset: 'custom' as const, from: '2019-01-01', to: '2026-06-30' };
    const span = (from: string, to: string) =>
      differenceInCalendarDays(parseISO(to), parseISO(from)) + 1;

    it('measures the comparison over the same span as the primary — both uncapped', fakeAsync(() => {
      const spy = spyOn(reports, 'getMenuSummary').and.callThrough();
      timeframe.set(OVER_CAP);
      timeframe.setComparison('prev-period');
      component.ngOnInit();
      tick(600);

      // [0] is the primary, [1] the comparison — both built eagerly, in source order.
      const [primary, comparison] = spy.calls.allArgs();
      const raw = span(OVER_CAP.from, OVER_CAP.to);
      const capped = span(
        resolveTimeframe(OVER_CAP).effectiveRange.from,
        resolveTimeframe(OVER_CAP).effectiveRange.to,
      );
      expect(capped).toBeLessThan(raw); // the fixture really is over the cap

      expect(span(primary[1], primary[2])).toBe(raw);
      expect(span(comparison[1], comparison[2])).toBe(raw);
      expect(span(comparison[1], comparison[2])).not.toBe(capped);
    }));
  });
});
