// Densification means the rail now meets zero-order buckets, which it never did before — the
// wire simply omitted a closed day. Two of the three sparklines should show a point on the axis
// there and one should show nothing at all, and that split is the whole subject of this spec.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { SalesKpiRailComponent } from './sales-kpi-rail.component';
import { SalesPoint, SalesTotals } from './sales-view';

describe('SalesKpiRailComponent', () => {
  let fixture: ComponentFixture<SalesKpiRailComponent>;
  let component: SalesKpiRailComponent;

  const point = (key: string, orders: number, revenue: number, discount: number): SalesPoint => ({
    label: key,
    key,
    orders,
    revenue,
    discount,
  });

  // Wed traded, Thu was closed, Fri traded — the ordinary shape after densification.
  const points: SalesPoint[] = [
    point('2026-07-01', 10, 450_000, 5_000),
    point('2026-07-02', 0, 0, 0),
    point('2026-07-03', 20, 900_000, 9_000),
  ];

  const totals: SalesTotals = {
    orders: 30,
    gross: 1_364_000,
    discounts: 14_000,
    revenue: 1_350_000,
    aov: 45_000,
  };

  const tile = (label: string) => component.tiles.find((t) => t.label === label)!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesKpiRailComponent],
      providers: [provideCharts(withDefaultRegisterables())],
    }).compileComponents();

    fixture = TestBed.createComponent(SalesKpiRailComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('points', points);
    fixture.componentRef.setInput('current', totals);
    fixture.detectChanges();
  });

  it('plots ZERO for orders and discounts on a closed bucket — that is a true statement', () => {
    expect(tile('Orders').series).toEqual([10, 0, 20]);
    expect(tile('Discounts').series).toEqual([5_000, 0, 9_000]);
  });

  it('plots NULL for average order value — with no orders there is nothing to average', () => {
    // A 0 here would draw a restaurant with a rock-steady ticket and a weekly closure as
    // violently volatile. Chart.js spanGaps defaults false, so null renders as a gap.
    expect(tile('Avg order value').series).toEqual([45_000, null, 45_000]);
  });

  it('leaves the tile VALUES on the range totals, untouched by any closure', () => {
    // The headline figures come from `current`, not from the series, so densification cannot
    // move them — the assertion behind "the axis changed, the numbers did not".
    expect(tile('Orders').value).toBe('30');
    expect(tile('Avg order value').value).toContain('45,000');
    expect(tile('Orders').current).toBe(30);
    expect(tile('Avg order value').current).toBe(45_000);
  });

  it('treats a null previous as a zero baseline, so the chip falls to its no-baseline branch', () => {
    // `previous` is null under the 'none' basis and zeroed for a fetched-but-empty window;
    // both coalesce to 0 here, which is why neither renders a percentage.
    expect(tile('Orders').previous).toBe(0);

    fixture.componentRef.setInput('previous', { ...totals, orders: 24 });
    fixture.detectChanges();
    expect(tile('Orders').previous).toBe(24);
  });
});
