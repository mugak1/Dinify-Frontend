import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportDateRangeComponent } from './report-date-range.component';
import { ReportDateRange } from '../../models/reports.models';

describe('ReportDateRangeComponent', () => {
  let component: ReportDateRangeComponent;
  let fixture: ComponentFixture<ReportDateRangeComponent>;
  let emitted: ReportDateRange[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportDateRangeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportDateRangeComponent);
    component = fixture.componentInstance;
    component.value = { preset: 'this-month', from: '2026-06-01', to: '2026-06-30' };
    emitted = [];
    component.valueChange.subscribe((r) => emitted.push(r));
    fixture.detectChanges();
  });

  it('renders a button per preset', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[app-dn-button]');
    expect(buttons.length).toBe(component.presets.length);
  });

  it('emits a concrete range when a preset is chosen', () => {
    component.selectPreset('today');
    expect(emitted.length).toBe(1);
    expect(emitted[0].preset).toBe('today');
    expect(emitted[0].from).toBe(emitted[0].to);
  });

  it('enters custom mode seeded from the current range', () => {
    component.selectPreset('custom');
    expect(emitted[0]).toEqual({ preset: 'custom', from: '2026-06-01', to: '2026-06-30' });
  });

  it('clamps to ≥ from on custom entry', () => {
    component.value = { preset: 'custom', from: '2026-06-10', to: '2026-06-20' };
    // Pick a "from" later than the current "to" → to is pulled forward.
    component.onCustomFrom('2026-06-25');
    expect(emitted[0]).toEqual({ preset: 'custom', from: '2026-06-25', to: '2026-06-25' });
  });

  it('keeps from ≤ to when the to input changes', () => {
    component.value = { preset: 'custom', from: '2026-06-10', to: '2026-06-20' };
    component.onCustomTo('2026-06-05'); // before from
    expect(emitted[0]).toEqual({ preset: 'custom', from: '2026-06-05', to: '2026-06-05' });
  });
});
