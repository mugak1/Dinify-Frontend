import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SavingsIndicatorComponent } from './savings-indicator.component';

describe('SavingsIndicatorComponent', () => {
  let fixture: ComponentFixture<SavingsIndicatorComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SavingsIndicatorComponent] }).compileComponents();
    fixture = TestBed.createComponent(SavingsIndicatorComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function render(props: Partial<SavingsIndicatorComponent>): void {
    Object.assign(fixture.componentInstance, props);
    fixture.detectChanges();
  }

  it('renders the slim "Save" pill by default', () => {
    render({ amount: 5000, variant: 'pill' });
    expect(host.textContent).toContain('Save UGX 5,000');
  });

  it('renders the aggregate "Total savings" banner', () => {
    render({ amount: 12000, variant: 'banner' });
    expect(host.textContent).toContain('Total savings');
    expect(host.textContent).toContain('UGX 12,000');
  });

  it('honours a custom label', () => {
    render({ amount: 800, variant: 'pill', label: 'You save' });
    expect(host.textContent).toContain('You save UGX 800');
  });
});
