import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoBaselineChipComponent } from './no-baseline-chip.component';

describe('NoBaselineChipComponent', () => {
  let fixture: ComponentFixture<NoBaselineChipComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NoBaselineChipComponent] }).compileComponents();
    fixture = TestBed.createComponent(NoBaselineChipComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('renders a "New" pill', () => {
    expect(host.textContent?.trim()).toBe('New');
  });

  // "New" on its own does not say what it is new *relative to*, so the aria-label carries
  // the entire explanation for screen-reader users. Pinned because it is easy to reword
  // away in passing, and because reports' delta-chip holds a duplicate that must match.
  it('pins the accessibility contract', () => {
    const pill = host.querySelector('span');
    expect(pill?.getAttribute('aria-label')).toBe('No prior period to compare');
  });
});
