import { ComponentFixture, TestBed } from '@angular/core/testing';

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
    expect(component.hasBaseline).toBeFalse();
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
});
