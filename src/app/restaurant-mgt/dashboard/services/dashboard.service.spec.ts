import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { DashboardService } from './dashboard.service';
import { ApiService } from '../../../_services/api.service';
import { ReportBucketUnit } from '../../../_shared/timeframe';

describe('DashboardService', () => {
  let service: DashboardService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj('ApiService', ['get']);

    TestBed.configureTestingModule({
      providers: [DashboardService, { provide: ApiService, useValue: api }],
    });

    service = TestBed.inject(DashboardService);
  });

  // The wire contract for reports/restaurant/dashboard-v2/. The backend resolves `bucket`
  // FAIL-CLOSED — an unrecognised value is a 400 naming the accepted set, not a silent
  // fallback to hourly — so getting these strings right is the difference between a chart
  // and an error. USE_MOCK_DATA is a `static` precisely so this branch is reachable.
  describe('real API contract (USE_MOCK_DATA = false)', () => {
    beforeEach(() => {
      DashboardService.USE_MOCK_DATA = false;
      api.get.and.returnValue(of({ data: null }) as never);
    });

    afterEach(() => {
      DashboardService.USE_MOCK_DATA = true;
    });

    const paramsOfLastCall = (): Record<string, unknown> =>
      api.get.calls.mostRecent().args[2] as Record<string, unknown>;

    it('sends restaurant / from / to / bucket to dashboard-v2', () => {
      service.getDashboardData('r1', '2026-06-01', '2026-06-30', 'day').subscribe();

      expect(api.get).toHaveBeenCalledWith(null, 'reports/restaurant/dashboard-v2/', {
        restaurant: 'r1',
        from: '2026-06-01',
        to: '2026-06-30',
        bucket: 'day',
      });
    });

    // Not merely "unused" — absent. The backend still honours `period`, and a caller
    // sending both is a caller the next reader has to reason about.
    it('never sends the legacy period parameter', () => {
      service.getDashboardData('r1', '2026-06-01', '2026-06-30', 'month').subscribe();

      expect('period' in paramsOfLastCall()).toBeFalse();
    });

    it('passes every bucket in the ladder through verbatim', () => {
      const buckets: ReportBucketUnit[] = ['hour', 'day', 'week', 'month', 'year'];

      for (const bucket of buckets) {
        service.getDashboardData('r1', '2026-06-01', '2026-06-30', bucket).subscribe();
        expect(paramsOfLastCall()['bucket']).withContext(bucket).toBe(bucket);
      }
    });
  });

  it('does not call the API while USE_MOCK_DATA is on', () => {
    service.getDashboardData('r1', '2026-06-01', '2026-06-30', 'day').subscribe();
    expect(api.get).not.toHaveBeenCalled();
  });
});
