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
});
