import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DateRangePanelComponent } from './date-range-panel.component';
import { ReportDateRange } from '../../models/reports.models';

describe('DateRangePanelComponent', () => {
  let fixture: ComponentFixture<DateRangePanelComponent>;
  let component: DateRangePanelComponent;

  function buttonByText(text: string): HTMLButtonElement | undefined {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return buttons.find((b) => (b.textContent ?? '').trim() === text);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DateRangePanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DateRangePanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('variant', 'popover');
    fixture.componentRef.setInput('today', '2026-06-21');
    fixture.componentRef.setInput('initial', {
      preset: 'this-month',
      from: '2026-06-01',
      to: '2026-06-30',
    } as ReportDateRange);
    fixture.detectChanges();
  });

  it('seeds staged from the initial range', () => {
    expect(component.staged).toEqual({ preset: 'this-month', from: '2026-06-01', to: '2026-06-30' });
    expect(component.staged).not.toBe(component.initial); // a copy, not the same ref
  });

  it('renders the 7 selectable presets and no Custom entry', () => {
    expect(component.presets.length).toBe(7);
    expect(component.presets).not.toContain('custom');
    expect(buttonByText('Today')).toBeTruthy();
    expect(buttonByText('Custom')).toBeUndefined();
  });

  it('a preset click stages without emitting apply, and reseeds the calendar', () => {
    const applySpy = jasmine.createSpy('applied');
    component.applied.subscribe(applySpy);
    const seedBefore = component.calendarSeed;

    buttonByText('Today')!.click();

    expect(component.staged.preset).toBe('today');
    expect(component.staged.from).toBe(component.staged.to);
    expect(applySpy).not.toHaveBeenCalled();
    expect(component.calendarSeed).not.toBe(seedBefore); // new ref -> calendar resets
  });

  it('a calendar pick stages a custom range WITHOUT changing the calendar seed', () => {
    const seedBefore = component.calendarSeed;

    component.onCalendarRange({ from: '2026-06-05', to: '2026-06-09' });

    expect(component.staged).toEqual({ preset: 'custom', from: '2026-06-05', to: '2026-06-09' });
    expect(component.calendarSeed).toBe(seedBefore); // identical ref -> no feedback loop
  });

  it('Apply emits the staged range exactly once', () => {
    const applySpy = jasmine.createSpy('applied');
    component.applied.subscribe(applySpy);

    component.onCalendarRange({ from: '2026-06-05', to: '2026-06-09' });
    buttonByText('Apply')!.click();

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy).toHaveBeenCalledWith({ preset: 'custom', from: '2026-06-05', to: '2026-06-09' });
  });

  it('Cancel emits cancel and never apply', () => {
    const applySpy = jasmine.createSpy('applied');
    const cancelSpy = jasmine.createSpy('cancelled');
    component.applied.subscribe(applySpy);
    component.cancelled.subscribe(cancelSpy);

    buttonByText('Cancel')!.click();

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(applySpy).not.toHaveBeenCalled();
  });
});
