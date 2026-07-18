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

/**
 * Service View is parked behind USE_MOCK_SERVICE (still `true`). Its write
 * methods must fail loud in their non-mock branch so a premature flag flip
 * can't silently no-op. The flag is a compile-time const, so the non-mock
 * branch is unreachable from a unit test; the loud-failure path is asserted
 * via the shared `serviceViewNotWired` helper, and the mock path is asserted to
 * still mutate state (behaviour unchanged).
 */
describe('TablesService Service-View fail-loud guard', () => {
  let service: TablesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TablesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  // No Service-View mutation under test hits the network in mock mode, so any
  // request would be an unexpected regression.
  afterEach(() => httpMock.verify());

  it('serviceViewNotWired throws a descriptive, method-named error', () => {
    expect(() =>
      (service as any).serviceViewNotWired('createReservation'),
    ).toThrowError(/createReservation: Service View is not wired/);
  });

  it('mock-path reservation mutations still update state without throwing', () => {
    expect(service.reservations$.value.length).toBe(0);

    expect(() => service.createReservation({ partySize: 4 })).not.toThrow();
    expect(service.reservations$.value.length).toBe(1);
    const id = service.reservations$.value[0].id;

    expect(() => service.updateReservation({ id, partySize: 6 })).not.toThrow();
    expect(service.reservations$.value[0].partySize).toBe(6);

    expect(() => service.markNoShow(id)).not.toThrow();
    expect(service.reservations$.value[0].status).toBe('no_show');

    expect(() => service.cancelReservation(id)).not.toThrow();
    expect(service.reservations$.value[0].status).toBe('cancelled');
  });

  it('mock-path waitlist add still updates state without throwing', () => {
    expect(service.waitlist$.value.length).toBe(0);
    expect(() => service.addToWaitlist({ partySize: 2 })).not.toThrow();
    expect(service.waitlist$.value.length).toBe(1);
  });
});

/**
 * Bulk create fans out one POST per table and wraps each in catchError, so a
 * single failed create never aborts the batch: forkJoin still emits once, with
 * one { number, ok } per spec in input order.
 */
describe('TablesService.bulkCreateTables', () => {
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

  it('isolates per-table failures and reports ok flags in input order', () => {
    let result: { number: number; ok: boolean }[] | undefined;
    service
      .bulkCreateTables([{ number: 3 }, { number: 4 }, { number: 5 }], 'r1')
      .subscribe(r => (result = r));

    const reqs = httpMock.match(
      r => r.url.includes('restaurant-setup/tables/') && r.method === 'POST',
    );
    expect(reqs.length).toBe(3);

    // Resolve out of order (3, 5 ok; 4 fails) to prove order-independence — the
    // emitted result must still follow the input order, not the response order.
    const byNumber = (n: number) =>
      reqs.find(r => r.request.body.number === n)!;
    byNumber(3).flush({ status: 200, message: 'ok', data: {} });
    byNumber(5).flush({ status: 200, message: 'ok', data: {} });
    byNumber(4).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(result).toEqual([
      { number: 3, ok: true },
      { number: 4, ok: false },
      { number: 5, ok: true },
    ]);
  });

  it('emits an empty array without firing any request for an empty batch', () => {
    let result: { number: number; ok: boolean }[] | undefined;
    service.bulkCreateTables([], 'r1').subscribe(r => (result = r));
    expect(result).toEqual([]);
  });
});

/**
 * Secure QR rotation. regenerateTableQr POSTs { table_id } to the backend
 * regenerate-qr action, validates the server-signed response, and patches
 * tables$ ONLY after validation — never optimistically, never with a
 * locally-minted credential/timestamp. On any error (HTTP or invalid
 * success-shape) local state is left untouched.
 */
describe('TablesService.regenerateTableQr', () => {
  let service: TablesService;
  let httpMock: HttpTestingController;

  const REGEN_URL = 'table-actions/regenerate-qr';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TablesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function seed(): void {
    service.tables$.next([
      { id: 't1', number: 5, hasQR: true, qrMode: 'order_pay', areaId: 'a1', qrCredential: 'OLD-1' } as any,
      { id: 't2', number: 6, hasQR: true, qrCredential: 'OLD-2' } as any,
    ]);
  }

  function okBody(over: Record<string, unknown> = {}) {
    return {
      status: 200,
      message: 'QR code regenerated successfully.',
      data: {
        id: 't1',
        number: 5,
        qr_version: 2,
        qr_regenerated_at: '2026-07-18T10:00:00Z',
        qr_credential: 'NEW-CRED-1',
        ...over,
      },
    };
  }

  const cred = (id: string) => service.tables$.value.find(t => t.id === id)!.qrCredential;

  it('POSTs exactly once to regenerate-qr with ONLY { table_id }', () => {
    seed();
    service.regenerateTableQr('t1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes(REGEN_URL));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ table_id: 't1' });
    // No restaurant id and no credential smuggled in as authority.
    expect(Object.keys(req.request.body)).toEqual(['table_id']);
    req.flush(okBody());
  });

  it('parses the envelope, maps qr_regenerated_at→Date and qr_credential verbatim', () => {
    seed();
    let result: any;
    service.regenerateTableQr('t1').subscribe(r => (result = r));
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody());
    expect(result.qrCredential).toBe('NEW-CRED-1');
    expect(result.qrVersion).toBe(2);
    expect(result.qrRegeneratedAt instanceof Date).toBeTrue();
    expect(result.qrRegeneratedAt.toISOString()).toBe('2026-07-18T10:00:00.000Z');
  });

  it('updates ONLY the rotated tables$ row after success, preserving unrelated fields', () => {
    seed();
    service.regenerateTableQr('t1').subscribe();
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody());
    const t1 = service.tables$.value.find(t => t.id === 't1')!;
    expect(t1.qrCredential).toBe('NEW-CRED-1');
    expect(t1.hasQR).toBeTrue();
    expect(t1.qrMode).toBe('order_pay'); // unrelated fields preserved
    expect(t1.areaId).toBe('a1');
    expect(t1.number).toBe(5);
    expect(cred('t2')).toBe('OLD-2'); // other row untouched
  });

  it('makes NO optimistic change — the old credential survives until the response', () => {
    seed();
    service.regenerateTableQr('t1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes(REGEN_URL));
    expect(cred('t1')).toBe('OLD-1'); // still the old one before flush
    req.flush(okBody());
    expect(cred('t1')).toBe('NEW-CRED-1');
  });

  it('rejects an empty/whitespace credential and leaves state untouched', () => {
    seed();
    let errored = false;
    service.regenerateTableQr('t1').subscribe({ error: () => (errored = true) });
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody({ qr_credential: '   ' }));
    expect(errored).toBeTrue();
    expect(cred('t1')).toBe('OLD-1');
  });

  it('rejects a mismatched response table id', () => {
    seed();
    let errored = false;
    service.regenerateTableQr('t1').subscribe({ error: () => (errored = true) });
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody({ id: 'OTHER' }));
    expect(errored).toBeTrue();
    expect(cred('t1')).toBe('OLD-1');
  });

  it('rejects a malformed timestamp', () => {
    seed();
    let errored = false;
    service.regenerateTableQr('t1').subscribe({ error: () => (errored = true) });
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody({ qr_regenerated_at: 'not-a-date' }));
    expect(errored).toBeTrue();
    expect(cred('t1')).toBe('OLD-1');
  });

  it('rejects a missing qr_version', () => {
    seed();
    let errored = false;
    service.regenerateTableQr('t1').subscribe({ error: () => (errored = true) });
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody({ qr_version: null }));
    expect(errored).toBeTrue();
    expect(cred('t1')).toBe('OLD-1');
  });

  it('leaves old state untouched on an HTTP error', () => {
    seed();
    let errored = false;
    service.regenerateTableQr('t1').subscribe({ error: () => (errored = true) });
    httpMock
      .expectOne(r => r.url.includes(REGEN_URL))
      .flush('boom', { status: 500, statusText: 'Server Error' });
    expect(errored).toBeTrue();
    expect(cred('t1')).toBe('OLD-1');
    expect(service.tables$.value.find(t => t.id === 't1')!.hasQR).toBeTrue();
  });

  it('never logs the old or new credential', () => {
    const spies = [
      spyOn(console, 'log'),
      spyOn(console, 'warn'),
      spyOn(console, 'error'),
      spyOn(console, 'info'),
      spyOn(console, 'debug'),
    ];
    seed();
    service.regenerateTableQr('t1').subscribe();
    httpMock.expectOne(r => r.url.includes(REGEN_URL)).flush(okBody());
    const leaked = spies.some(s =>
      s.calls.allArgs().some(args => {
        const dump = JSON.stringify(args);
        return dump.includes('NEW-CRED-1') || dump.includes('OLD-1');
      }),
    );
    expect(leaked).toBeFalse();
  });
});

/**
 * Initial QR ACTIVATION. activateQrForTables sets has_qr=true via per-table PUTs
 * with isolated failures (one {id, ok} per input id, in order). It never rotates
 * (no qr_version bump), never sends a client timestamp, and never revokes.
 */
describe('TablesService.activateQrForTables', () => {
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

  it('activates each table via a has_qr PUT (no rotation timestamp) and isolates failures', () => {
    let result: { id: string; ok: boolean }[] | undefined;
    service.activateQrForTables(['t1', 't2', 't3']).subscribe(r => (result = r));

    const reqs = httpMock.match(
      r => r.url.includes('restaurant-setup/tables/') && r.method === 'PUT',
    );
    expect(reqs.length).toBe(3);
    reqs.forEach(r => {
      expect(r.request.body.has_qr).toBeTrue();
      expect(r.request.body.qr_regenerated_at).toBeUndefined();
      expect(r.request.body.qr_credential).toBeUndefined();
    });

    const byId = (id: string) => reqs.find(r => r.request.body.id === id)!;
    byId('t1').flush({ status: 200, data: {} });
    byId('t3').flush({ status: 200, data: {} });
    byId('t2').flush('boom', { status: 500, statusText: 'Server Error' });

    expect(result).toEqual([
      { id: 't1', ok: true },
      { id: 't2', ok: false },
      { id: 't3', ok: true },
    ]);
  });

  it('emits [] and fires no request for an empty id list', () => {
    let result: { id: string; ok: boolean }[] | undefined;
    service.activateQrForTables([]).subscribe(r => (result = r));
    expect(result).toEqual([]);
  });
});
