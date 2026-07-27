import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { format } from 'date-fns';
import { BehaviorSubject } from 'rxjs';

import { TimeframePickerComponent } from './timeframe-picker.component';
import { ComparisonOption } from '../comparison-option';
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

    beforeEach(() => {
      picked = [];
      component.comparisonChange.subscribe((o) => picked.push(o));
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

    // The whole point of keying on shape: the menu is not a fixed list.
    it('RE-SHAPES its menu when the range changes shape', () => {
      fixture.componentRef.setInput('comparison', 'prev-month-by-day');
      fixture.detectChanges();
      cmpTrigger()!.click();
      fixture.detectChanges();
      // The month menu is the only one carrying by-day / by-date variants, and the only
      // one WITHOUT a bare 'Previous year' — at month level that means the same calendar
      // month, which is what 'Previous year by day' gives.
      expect(labels()).toEqual([
        'No comparison',
        'Previous month by day (Mon–Sun)',
        'Previous month by date (DD/MM)',
        'Previous year by day (Mon–Sun)',
        'Dates last year (DD/MM)',
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
      ]);
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
});
