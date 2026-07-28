import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { CdkConnectedOverlay, Overlay } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { format } from 'date-fns';
import { BehaviorSubject } from 'rxjs';

import {
  TimeframePickerComponent,
  timeframeOverlayPositions,
} from './timeframe-picker.component';
import { ComparisonOption } from '../comparison-option';
import { SALES_TRENDS_CAP_DAYS } from '../timeframe-engine';
import { ReportDateRange } from '../timeframe-range';

describe('TimeframePickerComponent', () => {
  let fixture: ComponentFixture<TimeframePickerComponent>;
  let component: TimeframePickerComponent;
  let emitted: ReportDateRange[];
  let bp$: BehaviorSubject<BreakpointState>;

  function trigger(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[aria-haspopup="dialog"]');
  }

  function overlayButton(text: string): HTMLButtonElement | undefined {
    const overlay = document.querySelector('.dn-daterange-overlay-panel');
    if (!overlay) return undefined;
    return Array.from(overlay.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === text,
    ) as HTMLButtonElement | undefined;
  }

  function overlayPanel(): Element | null {
    return document.querySelector('.dn-daterange-overlay-panel');
  }

  function arrow(label: 'Previous period' | 'Next period'): HTMLButtonElement {
    return fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);
  }

  beforeEach(async () => {
    bp$ = new BehaviorSubject<BreakpointState>({ matches: true, breakpoints: {} });

    await TestBed.configureTestingModule({
      imports: [TimeframePickerComponent],
      providers: [
        { provide: BreakpointObserver, useValue: { observe: () => bp$.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TimeframePickerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('value', {
      preset: 'this-month',
      from: '2026-06-01',
      to: '2026-06-30',
    } as ReportDateRange);
    emitted = [];
    component.valueChange.subscribe((r) => emitted.push(r));
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('renders the trigger showing the committed preset and span', () => {
    fixture.detectChanges();
    const text = (trigger().textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toContain('This month');
    expect(text).toContain('1–30 Jun 2026');
  });

  describe('desktop (popover)', () => {
    beforeEach(() => {
      bp$.next({ matches: true, breakpoints: {} });
      fixture.detectChanges();
    });

    it('opens an anchored CDK Overlay popover', () => {
      trigger().click();
      fixture.detectChanges();
      expect(overlayPanel()).toBeTruthy();
    });

    it('stages a preset without committing (no valueChange)', () => {
      trigger().click();
      fixture.detectChanges();
      overlayButton('Today')!.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeTruthy(); // still open
    });

    it('commits the staged range exactly once on Apply, then closes', () => {
      trigger().click();
      fixture.detectChanges();
      overlayButton('Today')!.click();
      fixture.detectChanges();
      overlayButton('Apply')!.click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].preset).toBe('today');
      expect(overlayPanel()).toBeNull();
    });

    it('discards on Cancel', () => {
      trigger().click();
      fixture.detectChanges();
      overlayButton('Cancel')!.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeNull();
    });

    it('discards on backdrop click', () => {
      trigger().click();
      fixture.detectChanges();
      const backdrop = document.querySelector('.cdk-overlay-backdrop') as HTMLElement;
      expect(backdrop).toBeTruthy();
      backdrop.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeNull();
    });

    it('discards on Escape', () => {
      trigger().click();
      fixture.detectChanges();
      overlayPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeNull();
    });
  });

  // The arrows step by the range's SHAPE; the arithmetic itself is pinned in
  // timeframe-engine.spec.ts. What matters here is the wiring: that they render, that a
  // click commits through the SAME `valueChange` the staged picker uses, that they never
  // open the panel, and that forward is really `disabled` at the present rather than just
  // styled to look it.
  //
  // Expectations are chosen to be independent of the real system date — the component
  // cannot be handed a `now` — so a step back from a whole June is asserted as May
  // (true for any `now`) and the forward step uses a range safely in the past.
  describe('period arrows', () => {
    beforeEach(() => {
      bp$.next({ matches: true, breakpoints: {} });
      fixture.detectChanges();
    });

    it('renders a labelled arrow on each side of the trigger', () => {
      expect(arrow('Previous period')).toBeTruthy();
      expect(arrow('Next period')).toBeTruthy();
    });

    it('steps back one whole calendar month, emitting exactly once', () => {
      arrow('Previous period').click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].from).toBe('2026-05-01');
      expect(emitted[0].to).toBe('2026-05-31');
    });

    it('steps forward one whole calendar month', () => {
      fixture.componentRef.setInput('value', {
        preset: 'custom',
        from: '2020-03-01',
        to: '2020-03-31',
      } as ReportDateRange);
      fixture.detectChanges();

      arrow('Next period').click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].from).toBe('2020-04-01');
      expect(emitted[0].to).toBe('2020-04-30');
    });

    it('does not open the staged picker', () => {
      arrow('Previous period').click();
      fixture.detectChanges();
      expect(overlayPanel()).toBeNull();
    });

    it('disables the forward arrow at the present, and enables it in the past', () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      fixture.componentRef.setInput('value', {
        preset: 'today',
        from: today,
        to: today,
      } as ReportDateRange);
      fixture.detectChanges();
      expect(arrow('Next period').disabled).toBeTrue();
      expect(arrow('Previous period').disabled).toBeFalse();

      fixture.componentRef.setInput('value', {
        preset: 'custom',
        from: '2020-03-01',
        to: '2020-03-31',
      } as ReportDateRange);
      fixture.detectChanges();
      expect(arrow('Next period').disabled).toBeFalse();
    });
  });

  describe('mobile (bottom sheet)', () => {
    beforeEach(() => {
      bp$.next({ matches: false, breakpoints: {} });
      fixture.detectChanges();
    });

    it('opens a bottom sheet (not an overlay)', () => {
      trigger().click();
      fixture.detectChanges();
      expect(overlayPanel()).toBeNull();
      expect(fixture.nativeElement.querySelector('app-date-range-panel')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.fixed.bottom-0')).toBeTruthy();
    });

    it('commits once on Apply', () => {
      trigger().click();
      fixture.detectChanges();
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('app-date-range-panel button'),
      ) as HTMLButtonElement[];
      buttons.find((b) => (b.textContent ?? '').trim() === 'Today')!.click();
      fixture.detectChanges();
      buttons.find((b) => (b.textContent ?? '').trim() === 'Apply')!.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      expect(emitted[0].preset).toBe('today');
    });
  });
  // ─── Comparison dropdown (TIMEFRAME-02A) ───────────────────────────────────────────
  //
  // A SECOND overlay on this component, with its own panelClass — `overlayPanel()` above
  // matches `.dn-daterange-overlay-panel`, so a shared class would make the date-range
  // specs silently pick this one up.
  describe('comparison basis dropdown', () => {
    const cmpTrigger = (): HTMLButtonElement | null =>
      fixture.nativeElement.querySelector('button[aria-haspopup="listbox"]');

    const cmpPanel = (): Element | null => document.querySelector('.dn-comparison-overlay-panel');

    const cmpOptions = (): HTMLButtonElement[] =>
      Array.from(cmpPanel()?.querySelectorAll('[role="option"]') ?? []) as HTMLButtonElement[];

    const labels = (): string[] => cmpOptions().map((b) => (b.textContent ?? '').trim());

    let picked: ComparisonOption[];
    let emitted: { option: ComparisonOption; customFrom?: string | null }[];

    beforeEach(() => {
      picked = [];
      emitted = [];
      component.comparisonChange.subscribe((e) => {
        picked.push(e.option);
        emitted.push(e);
      });
    });

    // assert here. The both-hosts coverage that replaced it lives in
    // `restaurant-mgt/timeframe-period-arrows.spec.ts`, which mounts the real Dashboard
    // and Reports shell — the right level to catch a host dropping the control.
    it('renders the trigger', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();

      const t = cmpTrigger()!;
      expect(t).not.toBeNull();
      expect(t.textContent).toContain('Previous month by day (Mon–Sun)');
      expect(t.getAttribute('aria-expanded')).toBe('false');
      // Sized to the cluster, like the arrows and the date trigger.
      expect(t.className).toContain('h-[38px]');
    });

    it('opens on click, sets aria-expanded, and marks the selected option', () => {
      fixture.componentRef.setInput('comparison', 'prev-year-by-day');
      fixture.detectChanges();

      cmpTrigger()!.click();
      fixture.detectChanges();

      expect(cmpTrigger()!.getAttribute('aria-expanded')).toBe('true');
      const selected = cmpOptions().filter((o) => o.getAttribute('aria-selected') === 'true');
      expect(selected.length).toBe(1);
      expect(selected[0].textContent).toContain('Previous year by day');
    });

    // ─── The user-placed window (TIMEFRAME-02D) ───────────────────────────────────
    //
    // 'Custom period' is the ONE menu entry that does not commit on pick — it needs a start
    // date, so it opens a staged calendar and commits on Apply. Everything here is about
    // that difference.
    describe("'Custom period'", () => {
      const startPanel = (): Element | null =>
        document.querySelector('.dn-comparison-start-overlay-panel');

      /** Open the dropdown and click the 'Custom period' entry. */
      function pickCustom(): void {
        cmpTrigger()!.click();
        fixture.detectChanges();
        const entry = cmpOptions().find((o) => (o.textContent ?? '').includes('Custom period'))!;
        entry.click();
        fixture.detectChanges();
      }

      it('opens a staged calendar instead of committing the basis', () => {
        pickCustom();

        expect(startPanel()).not.toBeNull();
        expect(picked).toEqual([]); // nothing committed yet
      });

      it('commits the basis AND the start together, in one emission', () => {
        pickCustom();
        const day = startPanel()!.querySelector<HTMLButtonElement>('button[data-iso="2026-05-01"]')!;
        day.click();
        fixture.detectChanges();
        (
          Array.from(startPanel()!.querySelectorAll('button')).find(
            (b) => (b.textContent ?? '').trim() === 'Apply',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        // ONE emission carrying BOTH — two would leave a frame where the basis is 'custom'
        // with a stale window, and every consumer pipeline would fetch it.
        expect(emitted.length).toBe(1);
        expect(emitted[0]).toEqual({ option: 'custom', customFrom: '2026-05-01' });
      });

      it('leaves the previous basis untouched on Cancel', () => {
        pickCustom();
        (
          Array.from(startPanel()!.querySelectorAll('button')).find(
            (b) => (b.textContent ?? '').trim() === 'Cancel',
          ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();

        expect(startPanel()).toBeNull();
        expect(emitted).toEqual([]);
      });

      // The range is June 2026 — 30 inclusive days — so a start s runs [s, s+29] and must
      // end before 1 Jun. The last legal start is therefore 2 May (2–31 May). Hand-computed;
      // the cell either renders disabled or it does not.
      it('blocks exactly the starts whose window would overlap the range', () => {
        pickCustom();
        const day = (iso: string): HTMLButtonElement =>
          startPanel()!.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`)!;

        expect(day('2026-05-02').disabled).toBeFalse(); // 2–31 May, clear of 1 Jun
        expect(day('2026-05-01').disabled).toBeFalse(); // 1–30 May
        expect(day('2026-05-03').disabled).toBeTrue(); // 3 May–1 Jun — overlaps by a day
        expect(day('2026-05-31').disabled).toBeTrue();
      });

      // Blocked means UNSELECTABLE, not rejected after the fact.
      it('a blocked day cannot be picked at all', () => {
        pickCustom();
        startPanel()!.querySelector<HTMLButtonElement>('button[data-iso="2026-05-03"]')!.click();
        fixture.detectChanges();

        expect(emitted).toEqual([]);
      });

      // THE ASYMMETRY, pinned: dates on the trigger for `custom` and for nothing else.
      it('shows the resolved window on the trigger — and only for custom', () => {
        fixture.componentRef.setInput('comparison', 'custom');
        fixture.componentRef.setInput('customComparisonFrom', '2026-03-01');
        fixture.detectChanges();
        // 31 days from 1 Mar is 1–31 Mar.
        expect(cmpTrigger()!.textContent).toContain('Custom period');
        expect(cmpTrigger()!.textContent).toContain('1–30 Mar 2026');

        fixture.componentRef.setInput('comparison', 'prev-year-by-day');
        fixture.detectChanges();
        // Every other basis's NAME already determines its window, so no dates.
        expect(cmpTrigger()!.textContent).toContain('Previous year by day');
        expect(cmpTrigger()!.textContent).not.toContain('2026');
      });

      it('shows the bare label while the window is unplaced', () => {
        fixture.componentRef.setInput('comparison', 'custom');
        fixture.componentRef.setInput('customComparisonFrom', null);
        fixture.detectChanges();

        expect(cmpTrigger()!.textContent!.trim()).toBe('Custom period');
      });
    });

    // The whole point of keying on shape: the menu is not a fixed list.
    it('RE-SHAPES its menu when the range changes shape', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();
      // The month menu is the only one carrying by-day / by-date variants, and the only
      // one WITHOUT a bare 'Previous year' — at month level that means the same calendar
      // month, which is what 'Previous year by day' gives.
      // 'Custom period' (02D) closes EVERY shape's menu, which is why it appears in both
      // assertions here — it is offered everywhere so a placed window survives a shape change.
      expect(labels()).toEqual([
        'No comparison',
        'Previous month by day (Mon–Sun)',
        'Previous month by date (DD/MM)',
        'Previous year by day (Mon–Sun)',
        'Dates last year (DD/MM)',
        'Custom period',
      ]);

      component.closeComparison();
      fixture.componentRef.setInput('value', {
        preset: 'today',
        from: '2026-06-15',
        to: '2026-06-15',
      } as ReportDateRange);
      fixture.componentRef.setInput('comparison', 'prev-day');
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();

      expect(labels()).toEqual([
        'No comparison',
        'Previous day',
        'Previous week',
        'Previous year',
        'Dates last year (DD/MM)',
        'Custom period',
      ]);
    });

    // ─── The menu describes the FETCHED window (TIMEFRAME-TIDY-00) ─────────────────
    //
    // 02B's rule: classify and resolve from the same window, because deriving the offered
    // set from one and the comparison from another is how a menu comes to offer a basis
    // the resolver will not honour. The picker classified `this.value` — the REQUESTED
    // range — while the resolver works from `effectiveRange`, the clamped window a request
    // is actually fetched over.
    //
    // THIS IS UNOBSERVABLE AT THE REAL CAP, and that is a fact about the boundaries rather
    // than about the fix. The two windows differ only above the 1850-day clamp, and no
    // shape spans anywhere near that (365 at the outside — see the engine spec's
    // "bounds every non-custom shape far below the clamp"), so above it BOTH read `custom`
    // and both spellings agree for every range a user can produce.
    //
    // So the invariant can only be watched by making divergence possible, which is what
    // the lowered cap below is for — a deliberate distortion of configuration, restored in
    // `afterEach`.
    //
    // IT HAS TO RUN IN THIS DIRECTION: `custom` raw, real shape once clamped. The obvious
    // construction is the reverse — take a whole calendar year and lower the cap under it
    // so `year` clamps to `custom` — and it CANNOT WORK, for a reason worth writing down
    // before someone spends an afternoon on it. The clamp branch sits after the ladder's
    // `month` rung (731 days, module-private), so a range only reaches it above 731 days
    // whatever the annual cap says; a 364-day year returns unclamped long before the cap
    // is consulted. No shape spans 731, so no shape can ever be the thing that clamps.
    //
    // Hence: a 1460-day `custom` range, and a cap of 364 chosen so the window it clamps to
    // lands exactly on 2025-01-01…2025-12-31 — a whole calendar `year`.
    describe('with the annual cap lowered so the two windows can diverge', () => {
      /** Four years, ending on a year boundary. Shape `custom`; span 1460, so it clamps. */
      const FOUR_YEARS: ReportDateRange = {
        preset: 'custom',
        from: '2022-01-01',
        to: '2025-12-31',
      };

      const realCap = SALES_TRENDS_CAP_DAYS.annual;
      afterEach(() => {
        SALES_TRENDS_CAP_DAYS.annual = realCap;
      });

      const openMenu = (value: ReportDateRange): void => {
        fixture.componentRef.setInput('value', value);
        fixture.componentRef.setInput('comparison', 'none');
        fixture.detectChanges();
        cmpTrigger()!.click();
        fixture.detectChanges();
      };

      it('offers the raw shape menu while nothing clamps', () => {
        // At the real 1850-day cap this range does not clamp, so `effectiveRange` IS
        // `value` and both spellings agree — the invariance half.
        openMenu(FOUR_YEARS);

        expect(labels()).toEqual(['No comparison', 'Previous period', 'Custom period']);
      });

      it("switches to the clamped window's menu once the same range exceeds the cap", () => {
        SALES_TRENDS_CAP_DAYS.annual = 364;

        openMenu(FOUR_YEARS);

        // 2025-12-31 less 364 days is 2025-01-01 (2025 is not a leap year), so the FETCHED
        // window is a whole calendar year and offers 'Previous year'. The raw range is
        // still `custom` and would offer 'Previous period' — a basis the resolver, working
        // from the clamped window, would not honour. That mismatch is what 02B forbids.
        expect(labels()).toEqual(['No comparison', 'Previous year', 'Custom period']);
      });
    });

    it('emits the picked basis and closes', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();

      cmpOptions().find((o) => (o.textContent ?? '').includes('Previous year by day'))!.click();
      fixture.detectChanges();

      expect(picked).toEqual(['prev-year-by-day']);
      expect(cmpPanel()).toBeNull();
    });

    it('does not re-emit when the current basis is picked again', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();

      cmpOptions().find((o) => (o.textContent ?? '').includes('Previous month by day (Mon–Sun)'))!.click();
      fixture.detectChanges();

      expect(picked).toEqual([]);
    });

    it('dismisses on Escape and on a backdrop click, emitting nothing', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();

      cmpTrigger()!.click();
      fixture.detectChanges();
      cmpPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(cmpPanel()).toBeNull();

      cmpTrigger()!.click();
      fixture.detectChanges();
      (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).dispatchEvent(
        new MouseEvent('click'),
      );
      fixture.detectChanges();
      expect(cmpPanel()).toBeNull();

      expect(picked).toEqual([]);
    });

    it('moves focus with ArrowDown / ArrowUp / Home / End', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();

      const items = cmpOptions();
      const press = (key: string) =>
        cmpPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

      press('Home');
      expect(document.activeElement).toBe(items[0]);
      press('ArrowDown');
      expect(document.activeElement).toBe(items[1]);
      press('ArrowUp');
      expect(document.activeElement).toBe(items[0]);
      press('End');
      expect(document.activeElement).toBe(items[items.length - 1]);
      // Wraps, so the list is navigable without hunting for the boundary.
      press('ArrowDown');
      expect(document.activeElement).toBe(items[0]);
    });

    // Shape here comes from `new Date()`, and from the service's own `new Date()` there.
    // Across midnight they can disagree for one render, and a menu with nothing selected
    // reads as a bug.
    it('still shows a selection the current shape does not offer', () => {
      fixture.componentRef.setInput('comparison', 'prev-day'); // not offered for a month
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();

      expect(labels()).toContain('Previous day');
      const selected = cmpOptions().filter((o) => o.getAttribute('aria-selected') === 'true');
      expect(selected.length).toBe(1);
    });

    it('leaves the date-range overlay untouched — separate panelClass, separate control', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();

      cmpTrigger()!.click();
      fixture.detectChanges();

      expect(cmpPanel()).not.toBeNull();
      expect(overlayPanel()).toBeNull(); // the date-range panel never opened
    });
  });

  // ─── Overlay positioning (PICKER-OVERLAY-00) ──────────────────────────────────────
  //
  // The cluster sits at the right edge of the page header, so an overlay anchored
  // start-to-start opens into whatever space is left over. The ~618px calendar did not
  // fit: at 1024px it overflowed by ~180px and rendered its whole second month off-frame.
  //
  // Geometry is awkward to assert in a unit test, so what is pinned here is the
  // CONFIGURATION, which is where the defect actually lived — and above all that all
  // THREE overlays read ONE array. They each hand-maintained their own copy before this,
  // and had already drifted apart on `withPush`; reference identity is what makes it
  // impossible to fix one placement and miss the other two.
  describe('overlay positioning (PICKER-OVERLAY-00)', () => {
    /**
     * Capture what an imperative overlay hands its position strategy, without reaching
     * into CDK privates. `callThrough` throughout, so the overlay still really opens.
     *
     * Install this immediately before the action under test and read `mostRecent()`: the
     * declarative comparison menu builds its strategy through the same `position()`
     * builder, so a spy left in place across two opens captures the wrong call.
     */
    function spyOnNextStrategy(): {
      withPositions: jasmine.Spy;
      withPush: jasmine.Spy;
      withFlexibleDimensions: jasmine.Spy;
    } {
      const overlay = TestBed.inject(Overlay);
      const builder = overlay.position();
      const strategy = builder.flexibleConnectedTo(document.createElement('div'));

      const withPositions = spyOn(strategy, 'withPositions').and.callThrough();
      const withPush = spyOn(strategy, 'withPush').and.callThrough();
      const withFlexibleDimensions = spyOn(strategy, 'withFlexibleDimensions').and.callThrough();

      spyOn(builder, 'flexibleConnectedTo').and.returnValue(strategy);
      spyOn(overlay, 'position').and.returnValue(builder);

      return { withPositions, withPush, withFlexibleDimensions };
    }

    /** The `cdkConnectedOverlay` on the comparison menu's `ng-template`. */
    function comparisonOverlayDirective(): CdkConnectedOverlay {
      const node = fixture.debugElement.queryAllNodes(By.directive(CdkConnectedOverlay))[0];
      return node.injector.get(CdkConnectedOverlay);
    }

    beforeEach(() => {
      bp$.next({ matches: true, breakpoints: {} });
      fixture.detectChanges();
    });

    it('offers four placements, end-aligned first', () => {
      const positions = timeframeOverlayPositions();

      expect(positions.length).toBe(4);

      // The primary pair opens LEFTWARD from the trigger's right edge — the fix for a
      // right-aligned control. Start-aligned survives only as the last resort.
      expect(positions.slice(0, 2).map((p) => [p.originX, p.overlayX])).toEqual([
        ['end', 'end'],
        ['end', 'end'],
      ]);
      expect(positions.slice(2).map((p) => [p.originX, p.overlayX])).toEqual([
        ['start', 'start'],
        ['start', 'start'],
      ]);

      // Each alignment carries a below-then-above vertical flip.
      expect(positions.map((p) => p.originY)).toEqual(['bottom', 'top', 'bottom', 'top']);
      expect(positions.map((p) => p.overlayY)).toEqual(['top', 'bottom', 'top', 'bottom']);
    });

    it('gives the calendar the shared array and enables push', () => {
      const spies = spyOnNextStrategy();

      trigger().click();
      fixture.detectChanges();

      expect(spies.withPositions.calls.mostRecent().args[0]).toBe(component.overlayPositions);
      expect(spies.withPush).toHaveBeenCalledWith(true);
      // A two-month calendar that reflows to fit is worse than one that repositions.
      expect(spies.withFlexibleDimensions).toHaveBeenCalledWith(false);
    });

    it('gives the comparison menu the SAME array and enables push', () => {
      const directive = comparisonOverlayDirective();

      // Reference identity, not deep equality: this is the assertion that a future edit
      // cannot fix one overlay's placement and leave the other behind.
      expect(directive.positions).toBe(component.overlayPositions);
      expect(directive.push).toBeTrue();
      // Unset in the template — pinned here so a CDK default flip cannot silently enable it.
      expect(directive.flexibleDimensions).toBeFalse();
    });

    it('gives the custom-start calendar the SAME array and enables push', () => {
      const cmpTrigger = (): HTMLButtonElement =>
        fixture.nativeElement.querySelector('button[aria-haspopup="listbox"]');

      cmpTrigger().click();
      fixture.detectChanges();
      const entry = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '.dn-comparison-overlay-panel [role="option"]',
        ),
      ).find((o) => (o.textContent ?? '').includes('Custom period'))!;

      // Only now — the menu above opened through the same `position()` builder.
      const spies = spyOnNextStrategy();
      entry.click();
      fixture.detectChanges();

      expect(document.querySelector('.dn-comparison-start-overlay-panel')).not.toBeNull();
      expect(spies.withPositions.calls.mostRecent().args[0]).toBe(component.overlayPositions);
      expect(spies.withPush).toHaveBeenCalledWith(true);
      expect(spies.withFlexibleDimensions).toHaveBeenCalledWith(false);
    });

    // This control is anchored, not overlaid, only ABOVE the breakpoint. Below it the
    // calendar is a full-width sheet that cannot overflow, so positioning must not have
    // reached into that path at all.
    it('still takes the sheet path below 1024px', () => {
      bp$.next({ matches: false, breakpoints: {} });
      fixture.detectChanges();

      trigger().click();
      fixture.detectChanges();

      expect(overlayPanel()).toBeNull();
      expect(fixture.nativeElement.querySelector('.fixed.bottom-0')).toBeTruthy();
    });
  });
});
