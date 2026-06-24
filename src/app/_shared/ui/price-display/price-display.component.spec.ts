import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PriceDisplayComponent } from './price-display.component';

describe('PriceDisplayComponent', () => {
  let fixture: ComponentFixture<PriceDisplayComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PriceDisplayComponent] }).compileComponents();
    fixture = TestBed.createComponent(PriceDisplayComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function render(props: Partial<PriceDisplayComponent>): HTMLElement {
    Object.assign(fixture.componentInstance, props);
    fixture.detectChanges();
    return host.firstElementChild as HTMLElement;
  }

  it('shows the effective price and the struck original when discounted', () => {
    const root = render({ effective: 800, original: 1000, size: 'lg' });
    expect(host.textContent).toContain('UGX 800');
    const struck = root.querySelector('.line-through') as HTMLElement;
    expect(struck).withContext('struck original should render').toBeTruthy();
    expect(struck.textContent).toContain('UGX 1,000');
  });

  it('hides the struck original when there is no reduction', () => {
    const root = render({ effective: 1000, original: 0 });
    expect(root.querySelector('.line-through')).toBeNull();
    expect(host.textContent).toContain('UGX 1,000');
  });

  it('prepends the prefix on both prices (extras "+UGX" form)', () => {
    render({ effective: 400, original: 500, prefix: '+' });
    expect(host.textContent).toContain('+UGX 400');
    expect(host.textContent).toContain('+UGX 500');
  });
});
