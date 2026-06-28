import { TestBed } from '@angular/core/testing';
import { OngoingOrderBannerComponent } from './ongoing-order-banner.component';

describe('OngoingOrderBannerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OngoingOrderBannerComponent],
    }).compileComponents();
  });

  it('renders the ongoing-order title and explanation', () => {
    const fixture = TestBed.createComponent(OngoingOrderBannerComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Order in progress');
    expect(text).toContain('order again once it has been served');
  });
});
