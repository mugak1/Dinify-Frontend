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

  it('renders the menu-card face: display extrabold 18.5px red effective + 13.5px struck original', () => {
    const root = render({ effective: 800, original: 1000, size: 'menu-card' });
    const effective = root.firstElementChild as HTMLElement;
    expect(effective.className).toContain('font-display');
    expect(effective.className).toContain('font-extrabold');
    expect(effective.className).toContain('text-dish-title');
    expect(effective.className).toContain('text-d-red');
    const struck = root.querySelector('.line-through') as HTMLElement;
    expect(struck.className).toContain('text-body');
  });

  it('tone="neutral" renders a neutral (gray-900) effective price; the default stays red', () => {
    const neutral = render({ effective: 800, size: 'sm', tone: 'neutral' });
    expect((neutral.firstElementChild as HTMLElement).className).toContain('text-gray-900');
    expect((neutral.firstElementChild as HTMLElement).className).not.toContain('text-d-red');
    const accent = render({ effective: 800, size: 'sm', tone: 'accent' });
    expect((accent.firstElementChild as HTMLElement).className).toContain('text-d-red');
  });
});
