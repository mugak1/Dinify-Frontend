import { ComponentFixture, TestBed } from '@angular/core/testing';

import { percentChange } from '../../../../_shared/utils/percent-change';
import { ReportDeltaChipComponent } from './delta-chip.component';

describe('ReportDeltaChipComponent', () => {
  let component: ReportDeltaChipComponent;
  let fixture: ComponentFixture<ReportDeltaChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ReportDeltaChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(ReportDeltaChipComponent);
    component = fixture.componentInstance;
  });

  function render(current: number, previous: number, invert = false) {
    component.current = current;
    component.previous = previous;
    component.invert = invert;
    fixture.detectChanges();
  }

  it('renders a "New" pill when there is no baseline', () => {
    render(500, 0);
    expect(component.changePercent).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('New');
  });

  it('shows a green ▲ for an increase', () => {
    render(120, 100);
    expect(component.magnitude).toBe('20.0');
    expect(component.up).toBeTrue();
    const pill = fixture.nativeElement.querySelector('span');
    expect(pill.className).toContain('text-success');
    expect(fixture.nativeElement.textContent).toContain('▲');
  });

  it('shows a red ▼ for a decrease', () => {
    render(80, 100);
    expect(component.magnitude).toBe('20.0');
    expect(component.up).toBeFalse();
    expect(fixture.nativeElement.querySelector('span').className).toContain('text-destructive');
    expect(fixture.nativeElement.textContent).toContain('▼');
  });

  it('inverts colour semantics when invert is set (a decrease reads good)', () => {
    render(80, 100, true);
    expect(component.up).toBeFalse(); // arrow still points down
    expect(component.positive).toBeTrue(); // but it is the good outcome → green
    expect(fixture.nativeElement.querySelector('span').className).toContain('text-success');
  });

  it('renders nothing when compare is disabled', () => {
    component.current = 120;
    component.previous = 100; // a real baseline that would otherwise show a delta
    component.compareEnabled = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('span')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  // ── The third state (REPORTS-COMPARISON-00) ────────────────────────────────────────
  //
  // A negative baseline is NOT a missing one. "New" claims there is no history to compare
  // against, which is false when the restaurant traded and the period netted below zero —
  // and the raw formula sign-flips there, so a recovery from -100k to 0 computed as -100%
  // and rendered as a red decline. Reachable via `sales-hero.prevNet`, which is
  // `previous.revenue - previousRefunds`. Nothing covered this before.
  describe('a negative baseline', () => {
    it('renders nothing at all — neither a percentage nor a "New" pill', () => {
      render(0, -100_000);
      expect(component.changePercent).toBeNull();
      expect(component.baselineIsNegative).toBeTrue();
      expect(fixture.nativeElement.querySelector('span')).toBeNull();
      expect(fixture.nativeElement.textContent.trim()).toBe('');
    });

    it('does not sign-flip a recovery into a decline', () => {
      render(200, -500);
      // The old local predicate rendered ▼ 140.0% in destructive red here.
      expect(fixture.nativeElement.textContent).not.toContain('%');
      expect(fixture.nativeElement.textContent).not.toContain('▼');
    });
  });

  // Zero was already covered above; these are the remaining reasons `percentChange` nulls
  // for an ABSENT baseline, all of which must still read "New" rather than nothing.
  describe('an absent baseline', () => {
    it('renders "New" for a non-finite previous', () => {
      for (const previous of [NaN, Infinity, -Infinity]) {
        render(500, previous);
        expect(fixture.nativeElement.textContent.trim())
          .withContext(String(previous))
          .toBe('New');
      }
    });

    it('renders "New" for a null previous rather than an -Infinity percentage', () => {
      render(500, null as unknown as number);
      expect(fixture.nativeElement.textContent.trim()).toBe('New');
    });
  });

  it('still renders a real decline in destructive red', () => {
    render(60, 100);
    expect(component.magnitude).toBe('40.0');
    expect(fixture.nativeElement.querySelector('span').className).toContain('text-destructive');
    expect(fixture.nativeElement.textContent).toContain('▼');
  });

  // ── Parity with the Dashboard badges ───────────────────────────────────────────────
  //
  // The point of the consolidation: one predicate, so the two surfaces cannot drift apart
  // again. Parity is asserted on the PERCENTAGE, which is what `percentChange` owns —
  // deliberately not on the rendered element, since Reports renders nothing on a negative
  // baseline where the Dashboard badges render "New". They agree there is no number; they
  // disagree only on what to draw in its place, and that is this component's own choice.
  it('computes the same percentage as the Dashboard cards for identical inputs', () => {
    const cases: [number, number][] = [
      [135, 120],
      [90, 120],
      [0, 120],
      [2_000_000, 0],
      [0, 0],
      [0, -100_000],
      [200, -500],
      [500, NaN],
    ];
    for (const [current, previous] of cases) {
      render(current, previous);
      expect(component.changePercent)
        .withContext(`${current} vs ${previous}`)
        .toEqual(percentChange(current, previous));
    }
  });
});
