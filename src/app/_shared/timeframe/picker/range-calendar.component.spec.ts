import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RangeCalendarComponent } from './range-calendar.component';

describe('RangeCalendarComponent', () => {
  let fixture: ComponentFixture<RangeCalendarComponent>;
  let component: RangeCalendarComponent;
  let emitted: { from: string; to: string }[];

  // Deterministic clock: "today" is 21 Jun 2026, seed starts on the 10th.
  const TODAY = '2026-06-21';

  function day(iso: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(`button[data-iso="${iso}"]`);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RangeCalendarComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RangeCalendarComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.rangeChange.subscribe((r) => emitted.push(r));

    // setInput triggers ngOnChanges, which builds the grid.
    fixture.componentRef.setInput('today', TODAY);
    fixture.componentRef.setInput('monthCount', 1);
    fixture.componentRef.setInput('seed', { from: '2026-06-10', to: '2026-06-10' });
    fixture.detectChanges();
  });

  it('renders the seeded month', () => {
    expect(day('2026-06-15')).toBeTruthy();
  });

  it('first click sets the start and clears the end (single-day emit)', () => {
    day('2026-06-15')!.click();
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({ from: '2026-06-15', to: '2026-06-15' });
  });

  it('a second click on/after the start completes the range', () => {
    day('2026-06-15')!.click();
    fixture.detectChanges();
    day('2026-06-20')!.click();
    expect(emitted[emitted.length - 1]).toEqual({ from: '2026-06-15', to: '2026-06-20' });
  });

  it('a click before the start restarts the selection', () => {
    day('2026-06-20')!.click();
    fixture.detectChanges();
    day('2026-06-12')!.click(); // before the start -> restart
    expect(emitted[emitted.length - 1]).toEqual({ from: '2026-06-12', to: '2026-06-12' });
  });

  it('extends after a restart', () => {
    day('2026-06-20')!.click();
    fixture.detectChanges();
    day('2026-06-12')!.click();
    fixture.detectChanges();
    day('2026-06-18')!.click();
    expect(emitted[emitted.length - 1]).toEqual({ from: '2026-06-12', to: '2026-06-18' });
  });

  it('disables dates after today', () => {
    const future = day('2026-06-25');
    expect(future).toBeTruthy();
    expect(future!.disabled).toBeTrue();
    future!.click();
    // Disabled clicks never emit.
    expect(emitted.length).toBe(0);
  });

  it('reseeding (new ref) resets the selection and reframes the view', () => {
    fixture.componentRef.setInput('seed', { from: '2026-05-05', to: '2026-05-05' });
    fixture.detectChanges();
    expect(day('2026-05-20')).toBeTruthy();
    expect(day('2026-06-15')).toBeNull();
    // After a reseed the next click starts fresh (single-day), not an extend.
    day('2026-05-12')!.click();
    expect(emitted[emitted.length - 1]).toEqual({ from: '2026-05-12', to: '2026-05-12' });
  });

  it('renders two months when monthCount is 2, end month on the right', () => {
    fixture.componentRef.setInput('monthCount', 2);
    fixture.componentRef.setInput('seed', { from: '2026-06-10', to: '2026-06-10' });
    fixture.detectChanges();
    // end month (June) on the right, previous month (May) on the left
    expect(day('2026-05-15')).toBeTruthy();
    expect(day('2026-06-10')).toBeTruthy();
  });

  // ─── Single-date mode + an explicit max (TIMEFRAME-02D) ──────────────────────────
  //
  // Everything above this point runs on the DEFAULTS (`mode='range'`, `max=''` → today) and
  // is unchanged by 02D — that is the proof the range path is untouched. These add the two
  // new inputs on top.
  describe("mode='single'", () => {
    beforeEach(() => {
      fixture.componentRef.setInput('mode', 'single');
      fixture.detectChanges();
    });

    it('emits a one-day range on every click', () => {
      day('2026-06-15')!.click();
      expect(emitted[emitted.length - 1]).toEqual({ from: '2026-06-15', to: '2026-06-15' });
    });

    // THE difference from range mode: there is no pending second click, so the next click
    // re-anchors rather than extending. In range mode this same sequence yields 15→18.
    it('RE-ANCHORS on the next click instead of extending', () => {
      day('2026-06-15')!.click();
      fixture.detectChanges();
      day('2026-06-18')!.click();

      expect(emitted[emitted.length - 1]).toEqual({ from: '2026-06-18', to: '2026-06-18' });
    });

    it('re-anchors backwards too, with no restart special case', () => {
      day('2026-06-18')!.click();
      fixture.detectChanges();
      day('2026-06-12')!.click();

      expect(emitted[emitted.length - 1]).toEqual({ from: '2026-06-12', to: '2026-06-12' });
    });
  });

  describe('max', () => {
    it('disables past an explicit max, tighter than today', () => {
      fixture.componentRef.setInput('max', '2026-06-12');
      fixture.detectChanges();

      expect(day('2026-06-12')!.disabled).toBeFalse();
      expect(day('2026-06-13')!.disabled).toBeTrue();
      // Still before today (the 21st), which the default bound would have allowed.
      expect(day('2026-06-15')!.disabled).toBeTrue();
    });

    it('a disabled day never emits, in either mode', () => {
      fixture.componentRef.setInput('max', '2026-06-12');
      for (const mode of ['range', 'single']) {
        fixture.componentRef.setInput('mode', mode);
        fixture.detectChanges();
        emitted.length = 0;
        day('2026-06-20')!.click();
        expect(emitted).withContext(mode).toEqual([]);
      }
    });

    // The month-nav clamp reads the same bound as the cells, so navigation stops where
    // selection does rather than offering a month of dead days.
    it('stops forward navigation at the max month, not at today', () => {
      fixture.componentRef.setInput('seed', { from: '2026-04-10', to: '2026-04-10' });
      fixture.componentRef.setInput('max', '2026-05-20');
      fixture.detectChanges();

      expect(component.nextDisabled).toBeFalse(); // April → May is allowed
      component.nextMonth();
      fixture.detectChanges();
      expect(component.nextDisabled).toBeTrue(); // …and May is as far as it goes
    });
  });
});
