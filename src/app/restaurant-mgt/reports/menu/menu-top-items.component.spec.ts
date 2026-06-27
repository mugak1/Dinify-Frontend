import { MenuTopItemsComponent } from './menu-top-items.component';
import { MenuRow } from '../models/reports.models';

// Pure (no TestBed): the card just ranks its input and swaps the metric on toggle.
describe('MenuTopItemsComponent', () => {
  const rows: MenuRow[] = [
    { name: 'A', order_count: 1, quantity_sold: 10, revenue: 100 },
    { name: 'B', order_count: 1, quantity_sold: 50, revenue: 20 },
  ];

  it('ranks by revenue by default and re-ranks when toggled to units', () => {
    const c = new MenuTopItemsComponent();
    c.items = rows;
    c.ngOnChanges();
    expect(c.displayItems.map((r) => r.name)).toEqual(['A', 'B']); // revenue 100 > 20
    expect(c.barWidth(c.displayItems[0])).toBe(100); // widest = top

    c.setBy('units');
    expect(c.displayItems.map((r) => r.name)).toEqual(['B', 'A']); // units 50 > 10
  });

  it('labels the metric by mode', () => {
    const c = new MenuTopItemsComponent();
    c.items = rows;
    c.setBy('units');
    expect(c.metricLabel(c.displayItems[0])).toContain('sold');
    c.setBy('revenue');
    expect(c.metricLabel(c.displayItems[0])).toContain('UGX');
  });

  it('emits fullMenu on request', () => {
    const c = new MenuTopItemsComponent();
    let emitted = false;
    c.fullMenu.subscribe(() => (emitted = true));
    c.fullMenu.emit();
    expect(emitted).toBeTrue();
  });
});
