import { TestBed } from '@angular/core/testing';
import { OngoingOrderBannerComponent } from './ongoing-order-banner.component';

describe('OngoingOrderBannerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OngoingOrderBannerComponent],
    }).compileComponents();
  });

  it('renders the default ongoing-order explanation', () => {
    const fixture = TestBed.createComponent(OngoingOrderBannerComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('order in progress');
  });

  it('renders an overridden message', () => {
    const fixture = TestBed.createComponent(OngoingOrderBannerComponent);
    fixture.componentInstance.message = 'The table has an ongoing order';
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('The table has an ongoing order');
  });
});
