import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MenuDishCardComponent } from './menu-dish-card.component';

describe('MenuDishCardComponent', () => {
  let fixture: ComponentFixture<MenuDishCardComponent>;
  let component: MenuDishCardComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MenuDishCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(MenuDishCardComponent);
    component = fixture.componentInstance;
    host = fixture.nativeElement as HTMLElement;
  });

  function render(props: Partial<MenuDishCardComponent>): void {
    Object.assign(fixture.componentInstance, props);
    fixture.detectChanges();
  }

  it('renders the name and the plain (non-discount) price', () => {
    render({ name: 'Jollof Rice', effectivePrice: 12000 });
    expect(host.textContent).toContain('Jollof Rice');
    expect(host.textContent).toContain('UGX 12,000');
  });

  it('emits cardClick when tapped and in stock', () => {
    const spy = jasmine.createSpy('cardClick');
    component.cardClick.subscribe(spy);
    render({ name: 'Soda', outOfStock: false });
    component.onCardClick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('suppresses cardClick (and shows the sold-out pill) when out of stock', () => {
    const spy = jasmine.createSpy('cardClick');
    component.cardClick.subscribe(spy);
    render({ name: 'Soup', outOfStock: true });
    component.onCardClick();
    expect(spy).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Sold out');
  });

  it('shows the green discount badge + struck original when discounted', () => {
    render({
      name: 'Combo',
      effectivePrice: 8000,
      originalPrice: 10000,
      showDiscount: true,
      discountPercent: 20,
      savings: 2000,
    });
    expect(host.textContent).toContain('20% off');
    expect(host.textContent).toContain('UGX 8,000'); // effective
    expect(host.textContent).toContain('UGX 10,000'); // struck original
  });

  it('exposes the in-stock card as a focusable button named by dish + price', () => {
    render({ name: 'Soda', effectivePrice: 5000, outOfStock: false });
    const btn = host.querySelector('[role="button"]') as HTMLElement;
    expect(btn.getAttribute('tabindex')).toBe('0');
    expect(btn.hasAttribute('aria-disabled')).toBeFalse();
    expect(btn.getAttribute('aria-label')).toBe('Soda, UGX 5,000');
  });

  it('makes an out-of-stock card inert (no tabindex, aria-disabled)', () => {
    render({ name: 'Soup', outOfStock: true });
    const btn = host.querySelector('[role="button"]') as HTMLElement;
    expect(btn.hasAttribute('tabindex')).toBeFalse();
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('opens (emits cardClick) on Enter and Space', () => {
    const spy = jasmine.createSpy('cardClick');
    component.cardClick.subscribe(spy);
    render({ name: 'Soda', outOfStock: false });
    const btn = host.querySelector('[role="button"]') as HTMLElement;
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
