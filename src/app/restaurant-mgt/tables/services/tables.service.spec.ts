import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TablesService } from './tables.service';

/**
 * Floor-plan save is now atomic: a single batch POST to the
 * table-actions/update-floor-plan endpoint with full geometry, replacing the
 * previous N fire-and-forget PUTs that swallowed errors.
 */
describe('TablesService.updateFloorPlan', () => {
  let service: TablesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TablesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('persists the whole layout in one batch POST and updates optimistically', () => {
    service.tables$.next([
      { id: 't1', x: 0, y: 0, width: 10, height: 10 } as any,
      { id: 't2', x: 0, y: 0, width: 10, height: 10 } as any,
    ]);

    let completed = false;
    service
      .updateFloorPlan('r1', [
        { id: 't1', floor_x: 11, floor_y: 22, floor_width: 5, floor_height: 6 },
        { id: 't2', floor_x: 33, floor_y: 44, floor_width: 7, floor_height: 8 },
      ])
      .subscribe(() => (completed = true));

    // Exactly one request (httpMock.verify() in afterEach guards extras).
    const req = httpMock.expectOne(r =>
      r.url.includes('table-actions/update-floor-plan'),
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      restaurant: 'r1',
      tables: [
        { id: 't1', floor_x: 11, floor_y: 22, floor_width: 5, floor_height: 6 },
        { id: 't2', floor_x: 33, floor_y: 44, floor_width: 7, floor_height: 8 },
      ],
    });

    // Optimistic update applied immediately, before the response arrives.
    const t1 = service.tables$.value.find(t => t.id === 't1')!;
    expect([t1.x, t1.y, t1.width, t1.height]).toEqual([11, 22, 5, 6]);

    req.flush({ status: 200, message: 'ok', data: { updated_count: 2 } });
    expect(completed).toBeTrue();
  });
});
