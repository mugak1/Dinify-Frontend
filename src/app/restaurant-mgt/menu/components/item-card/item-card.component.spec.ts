import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ItemCardComponent } from './item-card.component';
import { MenuItem } from 'src/app/_models/app.models';

function makeItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: 'item-1',
    name: 'Jollof Rice',
    description: '',
    primary_price: '10000',
    discounted_price: null,
    running_discount: false,
    image: null,
    section: 'sec-1',
    group: null,
    available: true,
    in_stock: true,
    is_extra: false,
    is_special: false,
    is_featured: false,
    is_popular: false,
    is_new: false,
    has_options: false,
    options: { hasModifiers: false, groups: [] },
    has_extras: false,
    extras: [],
    tags: [],
    allergens: [],
    discount_details: null,
    discount_percentage: 0,
    calories: null,
    ...overrides,
  } as MenuItem;
}

describe('ItemCardComponent — Hidden vs Sold-out state', () => {
  let fixture: ComponentFixture<ItemCardComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ItemCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(ItemCardComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function render(item: MenuItem): void {
    fixture.componentInstance.item = item;
    fixture.detectChanges();
  }

  it('labels an unavailable item "Hidden" (and not "Sold out")', () => {
    render(makeItem({ available: false, in_stock: true }));
    expect(host.textContent).toContain('Hidden');
    expect(host.textContent).not.toContain('Sold out');
  });

  it('labels an out-of-stock item "Sold out" (and not "Hidden")', () => {
    render(makeItem({ available: true, in_stock: false }));
    expect(host.textContent).toContain('Sold out');
    expect(host.textContent).not.toContain('Hidden');
  });

  it('shows BOTH badges when an item is hidden AND out of stock (independent axes)', () => {
    render(makeItem({ available: false, in_stock: false }));
    expect(host.textContent).toContain('Hidden');
    expect(host.textContent).toContain('Sold out');
  });

  it('shows neither state badge for a visible, in-stock item', () => {
    render(makeItem({ available: true, in_stock: true }));
    expect(host.textContent).not.toContain('Hidden');
    expect(host.textContent).not.toContain('Sold out');
  });

  it('gives the availability switch an accessible name that reflects the state', () => {
    render(makeItem({ available: true }));
    let sw = host.querySelector('app-dn-switch button[role="switch"]') as HTMLElement;
    expect(sw.getAttribute('aria-label')).toBe('Item is visible on the menu');

    render(makeItem({ available: false }));
    sw = host.querySelector('app-dn-switch button[role="switch"]') as HTMLElement;
    expect(sw.getAttribute('aria-label')).toBe('Item is hidden from the menu');
  });
});
