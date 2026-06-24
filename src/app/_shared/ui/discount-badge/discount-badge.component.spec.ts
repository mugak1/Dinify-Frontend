import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscountBadgeComponent } from './discount-badge.component';

describe('DiscountBadgeComponent', () => {
  let fixture: ComponentFixture<DiscountBadgeComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DiscountBadgeComponent] }).compileComponents();
    fixture = TestBed.createComponent(DiscountBadgeComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function render(props: Partial<DiscountBadgeComponent>): HTMLElement {
    Object.assign(fixture.componentInstance, props);
    fixture.detectChanges();
    return host.firstElementChild as HTMLElement;
  }

  it('renders a rounded percentage label', () => {
    render({ percent: 15.4, variant: 'frosted' });
    expect(host.textContent).toContain('15% off');
  });

  it('shows the frosted treatment with a sparkle disc', () => {
    const badge = render({ percent: 20, variant: 'frosted' });
    expect(badge.className).toContain('backdrop-blur');
    expect(badge.querySelector('svg')).withContext('sparkle disc').toBeTruthy();
  });

  it('omits the sparkle disc for the solid overlay style', () => {
    const badge = render({ percent: 20, variant: 'solid' });
    expect(badge.className).toContain('bg-green-600');
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('appends an optional "Save" suffix', () => {
    render({ percent: 10, save: 1500 });
    expect(host.textContent).toContain('Save UGX 1,500');
  });
});
