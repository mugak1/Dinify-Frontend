// Pure presentation logic for the Menu performance tab.
//
// Menu has NO time-series — the timeframe only changes the window the aggregates
// and rankings are computed over. These helpers turn the range-scoped menu-summary
// rows into the cards' view models (totals, item ranking, category bars). No DI, no
// component, no fetching — so every transform is unit-testable (menu-view.spec.ts).
// Mirrors sales-view.

import { MenuRow } from '../models/reports.models';

export type MenuMetric = 'units' | 'revenue';

export interface MenuTotals {
  /** Σ order_count. */
  orders: number;
  /** Σ quantity_sold (items sold). */
  units: number;
  /** UGX, Σ revenue. */
  revenue: number;
  /** UGX, revenue / units. */
  avgPrice: number;
}

export const EMPTY_MENU_TOTALS: MenuTotals = { orders: 0, units: 0, revenue: 0, avgPrice: 0 };

export interface RankedItem {
  name: string;
  units: number;
  revenue: number;
  /** The active metric's value (units or revenue). */
  value: number;
  /** value / Σvalue · 100 — share of the menu by the active metric. */
  pct: number;
}

export interface CategoryBar {
  name: string;
  revenue: number;
  /** revenue / max · 100 — bar width relative to the top category. */
  pct: number;
}

/** Range totals for the aggregate chips. */
export function menuTotals(rows: MenuRow[]): MenuTotals {
  const orders = rows.reduce((a, r) => a + r.order_count, 0);
  const units = rows.reduce((a, r) => a + r.quantity_sold, 0);
  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  return { orders, units, revenue, avgPrice: units > 0 ? Math.round(revenue / units) : 0 };
}

/** Items ranked by the active metric, each with its share-of-total; optionally top-N. */
export function rankItems(rows: MenuRow[], by: MenuMetric, limit?: number): RankedItem[] {
  const valueOf = (r: MenuRow): number => (by === 'units' ? r.quantity_sold : r.revenue);
  const total = rows.reduce((a, r) => a + valueOf(r), 0);
  const ranked = [...rows]
    .sort((a, b) => valueOf(b) - valueOf(a))
    .map((r) => ({
      name: r.name,
      units: r.quantity_sold,
      revenue: r.revenue,
      value: valueOf(r),
      pct: total > 0 ? (valueOf(r) / total) * 100 : 0,
    }));
  return limit != null ? ranked.slice(0, limit) : ranked;
}

/** Category rows as revenue bars (width relative to the busiest category), sorted desc. */
export function categoryBars(rows: MenuRow[]): CategoryBar[] {
  const max = rows.reduce((m, r) => Math.max(m, r.revenue), 0);
  return [...rows]
    .sort((a, b) => b.revenue - a.revenue)
    .map((r) => ({
      name: r.name,
      revenue: r.revenue,
      pct: max > 0 ? Math.round((r.revenue / max) * 100) : 0,
    }));
}
