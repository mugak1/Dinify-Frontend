import { TestBed, fakeAsync, tick } from '@angular/core/testing';

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

  it('produces a stable dataset for the same range (seeded PRNG)', fakeAsync(() => {
    let a: any = null;
    let b: any = null;
    service.getSalesAggregate('r1', '2026-03-01', '2026-03-31', 'daily').subscribe((r) => (a = r.data));
    tick(600);
    service.getSalesAggregate('r1', '2026-03-01', '2026-03-31', 'daily').subscribe((r) => (b = r.data));
    tick(600);

    expect(a).toEqual(b);
  }));
});
