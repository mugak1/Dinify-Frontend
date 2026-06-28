import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';

import { ReportsService } from './reports.service';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { LocalStorageService } from '../../../_services/storage/local-storage.service';
import { ReportDateRange } from '../models/reports.models';

describe('ReportsService', () => {
  let service: ReportsService;
  let setItem: jasmine.Spy;

  beforeEach(() => {
    setItem = jasmine.createSpy('setItem');

    TestBed.configureTestingModule({
      providers: [
        ReportsService,
        { provide: ApiService, useValue: jasmine.createSpyObj('ApiService', ['get', 'loadAllPages']) },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: { restaurant_id: 'r1' } },
        },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem } },
      ],
    });

    service = TestBed.inject(ReportsService);
  });

  it('seeds the date range to the this-month default', () => {
    expect(service.dateRange$.value.preset).toBe('this-month');
    expect(service.dateRange$.value.from <= service.dateRange$.value.to).toBeTrue();
  });

  it('persists the range, keyed by restaurant, when it changes', () => {
    const range: ReportDateRange = { preset: 'today', from: '2026-06-21', to: '2026-06-21' };
    service.dateRange$.next(range);

    expect(setItem).toHaveBeenCalled();
    const [key, value] = setItem.calls.mostRecent().args;
    expect(key).toBe('reports.dateRange:r1');
    expect(value).toEqual(range);
  });

  it('seeds the compare toggle on (preserving the always-on default)', () => {
    expect(service.compareEnabled$.value).toBeTrue();
  });

  it('persists the compare toggle, keyed by restaurant, when it changes', () => {
    service.compareEnabled$.next(false);

    expect(setItem).toHaveBeenCalled();
    const [key, value] = setItem.calls.mostRecent().args;
    expect(key).toBe('reports.compareEnabled:r1');
    expect(value).toBeFalse();
  });

  it('returns mock sales aggregate rows after the simulated latency', fakeAsync(() => {
    let rows: any = null;
    service.getSalesAggregate('r1', '2026-06-01', '2026-06-07', 'daily').subscribe((res) => {
      rows = res.data;
    });

    expect(rows).toBeNull(); // delayed
    tick(600);

    expect(Array.isArray(rows)).toBeTrue();
    expect(rows.length).toBe(7); // one bucket per inclusive day
    expect(rows[0].period).toBe('2026-06-01');
  }));

  it('returns mock sales listing rows after the simulated latency', fakeAsync(() => {
    let rows: any = null;
    service.getSalesListing('r1', '2026-06-01', '2026-06-02').subscribe((res) => {
      rows = res.data;
    });

    tick(600);

    expect(Array.isArray(rows)).toBeTrue();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].order_number).toMatch(/^ORD-\d{4}$/);
  }));

  it('returns 24 mock sales hourly rows after the simulated latency', fakeAsync(() => {
    let rows: any = null;
    service.getSalesHourly('r1', '2026-06-15', '2026-06-15').subscribe((res) => {
      rows = res.data;
    });

    expect(rows).toBeNull(); // delayed
    tick(600);

    expect(Array.isArray(rows)).toBeTrue();
    expect(rows.length).toBe(24); // one row per hour-of-day, zero-filled
    expect(rows[0].hour).toBe(0);
    expect(rows[23].hour).toBe(23);
  }));

  it('produces a stable dataset for the same range (seeded PRNG)', fakeAsync(() => {
    let a: any = null;
    let b: any = null;
    service.getSalesAggregate('r1', '2026-03-01', '2026-03-31', 'daily').subscribe((r) => (a = r.data));
    tick(600);
    service.getSalesAggregate('r1', '2026-03-01', '2026-03-31', 'daily').subscribe((r) => (b = r.data));
    tick(600);

    expect(a).toEqual(b);
  }));

  // Slug + param contract pins for the real-data path. We flip the mock gate so
  // the `else` branch runs, then assert the exact slug + params each report puts
  // on the wire match the backend contract (restaurant_reports.py dispatch).
  // Drift on EITHER side fails here loudly instead of silently 400-ing at flip.
  describe('real API contract (USE_MOCK_DATA = false)', () => {
    let api: jasmine.SpyObj<ApiService>;
    const FROM = '2026-06-01';
    const TO = '2026-06-30';

    beforeEach(() => {
      ReportsService.USE_MOCK_DATA = false;
      api = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
      api.get.and.returnValue(of({ data: [] }) as any);
      api.loadAllPages.and.returnValue(of([]) as any);
    });

    afterEach(() => {
      ReportsService.USE_MOCK_DATA = true;
    });

    it('Sales aggregate → sales-trends with category + result [REGRESSION: H1]', () => {
      service.getSalesAggregate('r1', FROM, TO, 'daily').subscribe();
      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/sales-trends/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
        category: 'daily',
        result: 'table',
      });
    });

    it('Sales aggregate → sends category=annual for a year-wide bucket [B2]', () => {
      // A multi-year range must reach the wire as category=annual (the backend caps
      // monthly at 731 days), NOT collapse to monthly. ReportGranularity must carry it.
      service.getSalesAggregate('r1', FROM, TO, 'annual').subscribe();
      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/sales-trends/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
        category: 'annual',
        result: 'table',
      });
    });

    it('Sales listing → sales-listing', () => {
      service.getSalesListing('r1', FROM, TO).subscribe();
      expect(api.loadAllPages).toHaveBeenCalledWith('reports/restaurant/sales-listing/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
      });
    });

    it('Sales hourly → sales-hourly (no category/result)', () => {
      service.getSalesHourly('r1', FROM, TO).subscribe();
      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/sales-hourly/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
      });
    });

    it('Menu summary → menu-summary with grouping', () => {
      service.getMenuSummary('r1', FROM, TO, 'sections').subscribe();
      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/menu-summary/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
        grouping: 'sections',
      });
    });

    it('Transactions summary → transactions-summary', () => {
      service.getTransactionsSummary('r1', FROM, TO).subscribe();
      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/transactions-summary/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
      });
    });

    it('Transactions listing → transactions-listing', () => {
      service.getTransactionsListing('r1', FROM, TO).subscribe();
      expect(api.loadAllPages).toHaveBeenCalledWith('reports/restaurant/transactions-listing/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
      });
    });

    it('Transactions listing with a status filter → ?status=', () => {
      service.getTransactionsListing('r1', FROM, TO, { status: 'success' }).subscribe();
      expect(api.loadAllPages).toHaveBeenCalledWith('reports/restaurant/transactions-listing/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
        status: 'success',
      });
    });

    it('Diners summary → diners-summary', () => {
      service.getDinersSummary('r1', FROM, TO).subscribe();
      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/diners-summary/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
      });
    });

    it('Diners listing → diners-listing', () => {
      service.getDinersListing('r1', FROM, TO).subscribe();
      expect(api.loadAllPages).toHaveBeenCalledWith('reports/restaurant/diners-listing/', {
        restaurant: 'r1',
        from: FROM,
        to: TO,
      });
    });
  });
});
