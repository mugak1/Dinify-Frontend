import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { CdkConnectedOverlay, Overlay } from '@angular/cdk/overlay';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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
  // ─── Focus return on close (PICKER-FOCUS-RESTORE-00) ──────────────────────────────
  //
  // Every way the range calendar closes returns focus to the date trigger, on both hosts.
  // `HTMLElement.click()` does NOT focus a button, which is exactly what a pointer click
  // does in Safari and in Firefox on macOS, so these specs start with focus on <body>.
  // Before the fix the panel's focus trap captured <body> at open and restored it at
  // close, and the user was dropped out of the header.
  describe('focus return on close', () => {
    function startUnfocused(): void {
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).not.toBe(trigger());
    }

    describe('desktop (popover)', () => {
      beforeEach(() => {
        bp$.next({ matches: true, breakpoints: {} });
        fixture.detectChanges();
        startUnfocused();
        trigger().click();
        fixture.detectChanges();
      });

      it('after Apply', () => {
        overlayButton('Today')!.click();
        fixture.detectChanges();
        overlayButton('Apply')!.click();
        fixture.detectChanges();
        expect(overlayPanel()).toBeNull();
        expect(document.activeElement).toBe(trigger());
      });

      it('after Cancel', () => {
        overlayButton('Cancel')!.click();
        fixture.detectChanges();
        expect(document.activeElement).toBe(trigger());
      });

      it('after a backdrop click', () => {
        (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).dispatchEvent(
          new MouseEvent('click'),
        );
        fixture.detectChanges();
        expect(document.activeElement).toBe(trigger());
      });

      it('after Escape', () => {
        overlayPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();
        expect(document.activeElement).toBe(trigger());
      });

      it('when a breakpoint flip discards the open popover', () => {
        bp$.next({ matches: false, breakpoints: {} });
        fixture.detectChanges();
        expect(overlayPanel()).toBeNull();
        expect(document.activeElement).toBe(trigger());
      });
    });

    describe('mobile (bottom sheet)', () => {
      const sheetButton = (text: string): HTMLButtonElement =>
        (
          Array.from(
            fixture.nativeElement.querySelectorAll('app-date-range-panel button'),
          ) as HTMLButtonElement[]
        ).find((b) => (b.textContent ?? '').trim() === text)!;

      beforeEach(() => {
        bp$.next({ matches: false, breakpoints: {} });
        fixture.detectChanges();
        startUnfocused();
        trigger().click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
      });

      // Each spec runs change detection after the close, because that pass is where the
      // sheet's focus trap is destroyed and restores what it captured. Asserting before it
      // would pass against the unfixed code and prove nothing.
      it('after Apply', () => {
        sheetButton('Today').click();
        fixture.detectChanges();
        sheetButton('Apply').click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger());
      });

      it('after Cancel', () => {
        sheetButton('Cancel').click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger());
      });

      it('after Escape', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger());
      });

      it('after a backdrop tap', () => {
        (fixture.nativeElement.querySelector('.bg-black\\/50') as HTMLElement).click();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger());
      });
    });

    // A pointer click that does not focus the button leaves focus wherever it already was,
    // and the host's focus trap captures THAT element at open and restores it at close.
    // What makes the trigger win is focusing it in `open()`, before either host captures
    // anything. A focus call inside `close()` would not help on the sheet path: the sheet's
    // restore runs in the change-detection pass after `close()` returns, and overrides it.
    describe('when focus was on another control before the click', () => {
      function openFromElsewhere(): void {
        arrow('Previous period').focus();
        expect(document.activeElement).toBe(arrow('Previous period'));
        trigger().click();
        fixture.detectChanges();
      }

      it('mobile: Cancel returns focus to the trigger, not the control focused before', () => {
        bp$.next({ matches: false, breakpoints: {} });
        fixture.detectChanges();
        openFromElsewhere();
        (
          Array.from(
            fixture.nativeElement.querySelectorAll('app-date-range-panel button'),
          ) as HTMLButtonElement[]
        )
          .find((b) => (b.textContent ?? '').trim() === 'Cancel')!
          .click();
        fixture.detectChanges();
        expect(document.activeElement).toBe(trigger());
      });

      it('desktop: Cancel returns focus to the trigger, not the control focused before', () => {
        bp$.next({ matches: true, breakpoints: {} });
        fixture.detectChanges();
        openFromElsewhere();
        overlayButton('Cancel')!.click();
        fixture.detectChanges();
        expect(document.activeElement).toBe(trigger());
      });
    });

    it('CONTROL: an arrow step opens nothing and moves no focus', () => {
      bp$.next({ matches: true, breakpoints: {} });
      fixture.detectChanges();
      startUnfocused();
      arrow('Previous period').click();
      fixture.detectChanges();
      expect(overlayPanel()).toBeNull();
      expect(document.activeElement).not.toBe(trigger());
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

    // 02A, pinned against the sheet migration next door: five short items, single-select,
    // applying immediately. It is a MENU, not a dialog, so it stays anchored at every width
    // while both calendars switch to a sheet below the breakpoint. The asymmetry is the
    // decision, not an oversight — this is what stops it being "fixed".
    it('stays an anchored overlay below the breakpoint, not a sheet', () => {
      bp$.next({ matches: false, breakpoints: {} });
      fixture.detectChanges();

      cmpTrigger()!.click();
      fixture.detectChanges();

      expect(cmpPanel()).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-dn-sheet [role="listbox"]')).toBeNull();
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

      /** The sheet-hosted panel (PICKER-SHEET-A11Y-00) — the template mount, below 1024px. */
      const sheetPanel = (): Element | null =>
        fixture.nativeElement.querySelector('app-dn-sheet app-comparison-start-panel');

      /**
       * The panel wherever it is mounted. Path-agnostic ON PURPOSE: the outcome specs below
       * must not know which host they are driving, because knowing is how a divergence
       * between the two gets written into the assertions along with the code.
       */
      const startPanelAnywhere = (): Element | null => startPanel() ?? sheetPanel();

      const goNarrow = (): void => {
        bp$.next({ matches: false, breakpoints: {} });
        fixture.detectChanges();
      };

      const panelDay = (iso: string): HTMLButtonElement =>
        startPanelAnywhere()!.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`)!;

      const panelButton = (text: string): HTMLButtonElement =>
        Array.from(startPanelAnywhere()!.querySelectorAll('button')).find(
          (b) => (b.textContent ?? '').trim() === text,
        ) as HTMLButtonElement;

      /** Open the dropdown and click the 'Custom period' entry. */
      function pickCustom(): void {
        cmpTrigger()!.click();
        fixture.detectChanges();
        const entry = cmpOptions().find((o) => (o.textContent ?? '').includes('Custom period'))!;
        entry.click();
        fixture.detectChanges();
      }

      // ─── Focus return on close (PICKER-FOCUS-RESTORE-02) ────────────────────────
      //
      // Regression pins for behaviour that already held: every way this panel closes
      // returns focus to the COMPARISON trigger, on both hosts. (Cancel is pinned beside
      // the dropdown's own close paths below.) Each spec starts with focus on another
      // control, because `HTMLElement.click()` does not focus a button, just as a Safari
      // click does not.
      describe('focus return on close', () => {
        function openFromElsewhere(desktop: boolean, reopen = false): void {
          bp$.next({ matches: desktop, breakpoints: {} });
          fixture.componentRef.setInput('comparison', reopen ? 'custom' : 'prev-month-by-day');
          if (reopen) fixture.componentRef.setInput('customComparisonFrom', '2026-04-01');
          fixture.detectChanges();
          arrow('Previous period').focus();
          pickCustom();
          tick();
          expect(startPanelAnywhere()).not.toBeNull();
        }

        /** Runs the change-detection pass that tears the sheet host down, then asserts. */
        function expectClosedOnTrigger(): void {
          fixture.detectChanges();
          tick();
          fixture.detectChanges();
          expect(startPanelAnywhere()).toBeNull();
          expect(document.activeElement).toBe(cmpTrigger());
        }

        for (const desktop of [true, false]) {
          const host = desktop ? 'desktop' : 'mobile';

          it(`${host}: after Apply`, fakeAsync(() => {
            openFromElsewhere(desktop);
            panelDay('2026-05-01').click();
            fixture.detectChanges();
            panelButton('Apply').click();
            expectClosedOnTrigger();
            expect(emitted.length).toBe(1);
          }));

          it(`${host}: after Escape`, fakeAsync(() => {
            openFromElsewhere(desktop);
            if (desktop) {
              startPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            } else {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            }
            expectClosedOnTrigger();
          }));

          it(`${host}: after a backdrop click`, fakeAsync(() => {
            openFromElsewhere(desktop);
            if (desktop) {
              (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).dispatchEvent(
                new MouseEvent('click'),
              );
            } else {
              (fixture.nativeElement.querySelector('app-dn-sheet .bg-black\\/50') as HTMLElement).click();
            }
            expectClosedOnTrigger();
          }));

          it(`${host}: when a breakpoint flip discards it`, fakeAsync(() => {
            openFromElsewhere(desktop);
            bp$.next({ matches: !desktop, breakpoints: {} });
            expectClosedOnTrigger();
          }));

          it(`${host}: reopened to edit a placed start, then Cancel`, fakeAsync(() => {
            openFromElsewhere(desktop, true);
            panelButton('Cancel').click();
            expectClosedOnTrigger();
          }));
        }
      });

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

      // ─── The mount host (PICKER-SHEET-A11Y-00) ────────────────────────────────────
      //
      // 02D mounted this panel in a CDK Overlay at EVERY width and passed
      // `variant: isDesktop ? 'popover' : 'sheet'`. That input is styling AND a semantics
      // switch — the panel drops role/aria-modal/trap in the sheet variant on the assumption
      // that a host supplies them — and below the breakpoint no host did. So these assert the
      // HOST, never the styling: `variant` read correctly the entire time it was wrong.

      it('mounts inside app-dn-sheet below the breakpoint, not an overlay', () => {
        goNarrow();
        pickCustom();

        expect(startPanel()).toBeNull();
        expect(sheetPanel()).toBeTruthy();
      });

      it('mounts in the CDK overlay above the breakpoint, not a sheet', () => {
        pickCustom(); // bp$ seeds desktop

        expect(startPanel()).not.toBeNull();
        expect(sheetPanel()).toBeNull();
      });

      it('lets the sheet host supply the dialog semantics the panel drops', () => {
        goNarrow();
        pickCustom();

        // Present and configured. The trap's own behaviour is sheet.component.spec's job —
        // re-testing it here would just pin the same code twice.
        const host: HTMLElement = fixture.nativeElement.querySelector(
          'app-dn-sheet [role="dialog"]',
        );
        expect(host).toBeTruthy();
        expect(host.getAttribute('aria-modal')).toBe('true');
        expect(host.getAttribute('aria-label')).toBe('Choose the comparison period start');
        expect(host.querySelector('app-comparison-start-panel')).toBeTruthy();
        expect(fixture.nativeElement.querySelector('app-dn-sheet [cdkTrapFocus]')).toBeTruthy();

        // ...and the panel does not nest a SECOND dialog inside that one.
        const panelRoot = sheetPanel()!.querySelector('.bg-popover')!;
        expect(panelRoot.getAttribute('role')).toBeNull();
        expect(panelRoot.hasAttribute('aria-modal')).toBeFalse();
        expect(panelRoot.hasAttribute('aria-label')).toBeFalse();
      });

      it('closes the sheet on Escape without committing', () => {
        goNarrow();
        pickCustom();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        fixture.detectChanges();

        expect(startPanelAnywhere()).toBeNull();
        expect(emitted).toEqual([]);
      });

      // The range panel has always been discarded on a flip; since this panel also picks its
      // host by breakpoint, leaving it would strand a bottom sheet at desktop width.
      it('discards the surface on a breakpoint flip, like the range panel', () => {
        goNarrow();
        pickCustom();

        bp$.next({ matches: true, breakpoints: {} });
        fixture.detectChanges();

        expect(startPanelAnywhere()).toBeNull();
        expect(emitted).toEqual([]);
      });

      // ─── Outcome parity ───────────────────────────────────────────────────────────
      //
      // THE pair that matters. A panel that applies on desktop and silently discards on a
      // phone would be a worse bug than the a11y gap this closes, and invisible until
      // someone used one. Identical bodies; `startPanelAnywhere()` decides nothing.
      const hosts: ReadonlyArray<[string, () => void]> = [
        ['desktop overlay', () => undefined],
        ['mobile sheet', () => goNarrow()],
      ];

      hosts.forEach(([host, mount]) => {
        it(`commits the basis and the start together on Apply — ${host}`, () => {
          mount();
          pickCustom();

          panelDay('2026-05-01').click();
          fixture.detectChanges();
          panelButton('Apply').click();
          fixture.detectChanges();

          // ONE emission carrying BOTH, on either host.
          expect(emitted).toEqual([{ option: 'custom', customFrom: '2026-05-01' }]);
          expect(startPanelAnywhere()).toBeNull();
        });

        it(`leaves the previous basis untouched on Cancel — ${host}`, () => {
          mount();
          pickCustom();

          panelButton('Cancel').click();
          fixture.detectChanges();

          expect(startPanelAnywhere()).toBeNull();
          expect(emitted).toEqual([]);
        });
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

    // ─── Focus return on close (PICKER-FOCUS-RESTORE-01) ──────────────────────────
    //
    // Every way the menu closes returns focus to its trigger. Each spec starts with focus
    // on ANOTHER control, because `HTMLElement.click()` does not focus the trigger (as a
    // Safari click does not), so nothing but the component can put focus back on it.
    //
    // Tab was the one path that did not: the menu lives in the overlay container at the
    // end of <body>, so Tab from an option left focus past the end of the document with
    // the menu and its backdrop still open. The browser half of the fix (Tab carrying on
    // from the trigger to the next control, Shift+Tab to the previous one) cannot be
    // produced by a synthetic event; it was checked against real Chromium with trusted
    // key presses.
    describe('focus return on close', () => {
      const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        cmpPanel()!.dispatchEvent(event);
        return event;
      };
      const option = (text: string): HTMLButtonElement =>
        cmpOptions().find((o) => (o.textContent ?? '').includes(text))!;

      function openFromElsewhere(desktop: boolean): void {
        bp$.next({ matches: desktop, breakpoints: {} });
        fixture.componentRef.setInput('comparison', 'prev-month-by-day');
        fixture.detectChanges();
        arrow('Previous period').focus();
        cmpTrigger()!.click();
        fixture.detectChanges();
        tick(); // the menu focuses its selected option on the next macrotask
        expect(document.activeElement).toBe(option('Previous month by day'));
      }

      for (const desktop of [true, false]) {
        const host = desktop ? 'desktop' : 'mobile';

        it(`${host}: Tab closes the menu and returns focus to the trigger`, fakeAsync(() => {
          openFromElsewhere(desktop);
          press('Tab');
          fixture.detectChanges();
          expect(cmpPanel()).toBeNull();
          expect(cmpTrigger()!.getAttribute('aria-expanded')).toBe('false');
          expect(document.activeElement).toBe(cmpTrigger());
        }));

        it(`${host}: Shift+Tab does the same`, fakeAsync(() => {
          openFromElsewhere(desktop);
          press('Tab', { shiftKey: true });
          fixture.detectChanges();
          expect(cmpPanel()).toBeNull();
          expect(document.activeElement).toBe(cmpTrigger());
        }));

        // CONTROLS: the other close paths already returned focus. Pinned here so the
        // whole set is stated in one place, from the same starting point.
        it(`CONTROL ${host}: Escape`, fakeAsync(() => {
          openFromElsewhere(desktop);
          press('Escape');
          fixture.detectChanges();
          expect(document.activeElement).toBe(cmpTrigger());
        }));

        it(`CONTROL ${host}: a backdrop click`, fakeAsync(() => {
          openFromElsewhere(desktop);
          (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).dispatchEvent(
            new MouseEvent('click'),
          );
          fixture.detectChanges();
          expect(document.activeElement).toBe(cmpTrigger());
        }));

        it(`CONTROL ${host}: picking a different basis`, fakeAsync(() => {
          openFromElsewhere(desktop);
          option('Previous year by day').click();
          fixture.detectChanges();
          expect(document.activeElement).toBe(cmpTrigger());
        }));

        it(`CONTROL ${host}: re-picking the current basis`, fakeAsync(() => {
          openFromElsewhere(desktop);
          option('Previous month by day').click();
          fixture.detectChanges();
          expect(document.activeElement).toBe(cmpTrigger());
        }));

        it(`CONTROL ${host}: 'Custom period' then Cancel`, fakeAsync(() => {
          openFromElsewhere(desktop);
          option('Custom period').click();
          fixture.detectChanges();
          const panel =
            document.querySelector('.dn-comparison-start-overlay-panel') ??
            fixture.nativeElement.querySelector('app-comparison-start-panel');
          (Array.from(panel!.querySelectorAll('button')) as HTMLButtonElement[])
            .find((b) => (b.textContent ?? '').trim() === 'Cancel')!
            .click();
          fixture.detectChanges();
          expect(document.activeElement).toBe(cmpTrigger());
        }));
      }

      it('Tab leaves the default action alone, so the browser moves on from the trigger', fakeAsync(() => {
        openFromElsewhere(true);
        expect(press('Tab').defaultPrevented).toBeFalse();
      }));

      it('CONTROL: Escape still prevents its default action', fakeAsync(() => {
        openFromElsewhere(true);
        expect(press('Escape').defaultPrevented).toBeTrue();
      }));

      it('Tab commits nothing, even after arrowing to another option', fakeAsync(() => {
        openFromElsewhere(true);
        press('ArrowDown');
        expect(document.activeElement).not.toBe(option('Previous month by day'));
        press('Tab');
        fixture.detectChanges();
        expect(picked).toEqual([]);
        expect(cmpTrigger()!.textContent).toContain('Previous month by day');
      }));
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
