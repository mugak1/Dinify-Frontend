import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReportStateComponent } from './report-state.component';

describe('ReportStateComponent', () => {
  let component: ReportStateComponent;
  let fixture: ComponentFixture<ReportStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportStateComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportStateComponent);
    component = fixture.componentInstance;
  });

  function renderMode(mode: any) {
    component.mode = mode;
    fixture.detectChanges();
  }

  it('shows the under-construction copy for placeholders', () => {
    renderMode('under-construction');
    expect(fixture.nativeElement.textContent).toContain("We're still building this report");
  });

  it('shows the long-range guard message', () => {
    renderMode('listing-guard');
    expect(fixture.nativeElement.textContent).toContain('31 days or less');
  });

  it('renders a skeleton (no heading) while loading', () => {
    renderMode('loading');
    expect(fixture.nativeElement.querySelector('.animate-pulse')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('h3')).toBeNull();
  });

  it('offers a retry only in the error mode', () => {
    const emitted: number[] = [];
    component.retry.subscribe(() => emitted.push(1));

    renderMode('empty');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();

    renderMode('error');
    const btn = fixture.nativeElement.querySelector('button');
    expect(btn).not.toBeNull();
    btn.click();
    expect(emitted.length).toBe(1);
  });

  it('honours title/message overrides', () => {
    component.mode = 'empty';
    component.title = 'Custom title';
    component.message = 'Custom message';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Custom title');
    expect(fixture.nativeElement.textContent).toContain('Custom message');
  });
});
