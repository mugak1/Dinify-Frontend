import {
  HTTP_INTERCEPTORS,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptorsFromDi,
  withXhr,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER, of, throwError } from 'rxjs';
import { FLOOR_COMMAND_TIMEOUT_MS, FloorService, StatusAnswer } from './floor.service';
import { FloorMockBackend } from './floor-mock-backend';
import { FloorHttpTransport } from './floor-http-transport';
import { FLOOR_DEV_MODE } from './floor-view-gate';
import { MOCK_FLOOR_IDS } from '../data/floor-mock-data';
import { RoundCommandAnswer, ROUND_REFUSAL_REASONS } from '../models/floor.models';
import { ErrorInterceptor } from '../../../_helpers/error.interceptor';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ToastService } from '../../../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../../../_services/connectivity.service';
import { environment } from '../../../../environments/environment';

const CLOCK = Date.parse('2026-11-03T16:00:00Z');

function setUp(devMode: boolean): { service: FloorService; backend: FloorMockBackend; http: FloorHttpTransport } {
  TestBed.configureTestingModule({
    providers: [
      { provide: FLOOR_DEV_MODE, useValue: devMode },
      provideHttpClient(withXhr()),
      provideHttpClientTesting(),
    ],
  });
  const backend = TestBed.inject(FloorMockBackend);
  backend.clock = () => CLOCK;
  return { service: TestBed.inject(FloorService), backend, http: TestBed.inject(FloorHttpTransport) };
}

const T = (hhmm: string) => `2026-11-03T${hhmm}:00.000+03:00`;
function wireRound(state: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: 'o-1', round_number: 1, state, source: 'diner',
    accepted_at: T('18:58'), accepted_at_provenance: 'acceptance',
    held_since: state === 'held' ? T('18:58') : null,
    released_at: state === 'released' ? T('19:00') : null,
    stale: false, fulfilment_status: 'new', item_count: 2, value: '16000.00',
    ...over,
  };
}

describe('FloorService — which transport answers', () => {
  afterEach(() => (FloorService.USE_MOCK_DATA = false));

  it('LIVE: the mock flag is OFF, so every build reads the real endpoints', () => {
    expect(FloorService.USE_MOCK_DATA).toBeFalse();
  });

  for (const devMode of [false, true]) {
    it(`with the flag off, reads the HTTP transport and never the mock (devMode ${devMode})`, () => {
      const { service, backend, http } = setUp(devMode);
      const mock = spyOn(backend, 'getFloor').and.callThrough();
      const real = spyOn(http, 'getFloor').and.returnValue(NEVER);
      // Unsubscribed before the spec ends: a read left open would arm the service's
      // real read-timeout timer and fail whichever spec is running when it fires.
      const sub = service.loadFloor('r-1').subscribe();
      expect(real).toHaveBeenCalledOnceWith('r-1');
      expect(mock).not.toHaveBeenCalled();
      sub.unsubscribe();
    });
  }

  it('serves the mock floor in a development build when the flag is turned on (the local preview)', fakeAsync(() => {
    const { service, http } = setUp(true);
    FloorService.USE_MOCK_DATA = true;
    const real = spyOn(http, 'getFloor');
    let kind = '';
    service.loadFloor('r-1').subscribe(r => (kind = r.kind));
    tick(FloorMockBackend.READ_DELAY_MS);
    expect(kind).toBe('ok');
    expect(real).not.toHaveBeenCalled();
  }));

  it('PRODUCTION NEVER SERVES MOCK DATA: with the flag left on outside a development build, every call is refused', fakeAsync(() => {
    const { service, backend, http } = setUp(false);
    FloorService.USE_MOCK_DATA = true;
    const mocks = ['getFloor', 'getTable', 'command', 'setTableStatus'].map(m => spyOn(backend, m as never).and.callThrough());
    const reals = ['getFloor', 'getTable', 'command', 'setTableStatus'].map(m => spyOn(http, m as never).and.callThrough());
    let error: unknown = null;
    let value: unknown = null;
    service.loadFloor('r-1').subscribe({ next: v => (value = v), error: e => (error = e) });
    service.loadTable('r-1', MOCK_FLOOR_IDS.freshHeldTable).subscribe({ error: () => undefined });
    let answer: unknown = null;
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => (answer = a));
    let status: unknown = null;
    service.setTableStatus('r-1', MOCK_FLOOR_IDS.freeTable, 'dirty').subscribe(a => (status = a));
    tick(5_000);
    expect(value).toBeNull();
    expect(String(error)).toContain('never served outside a development build');
    expect(answer).toEqual({ kind: 'unknown' });
    expect(status).toEqual({ kind: 'unknown' });
    for (const spy of [...mocks, ...reals]) expect(spy).not.toHaveBeenCalled();
  }));
});

describe('FloorService — answers (mock transport)', () => {
  let service: FloorService;
  let backend: FloorMockBackend;

  beforeEach(() => {
    ({ service, backend } = setUp(true));
    FloorService.USE_MOCK_DATA = true;
  });
  afterEach(() => (FloorService.USE_MOCK_DATA = false));

  it('confirms a held round: the answer carries the round as the server now has it', fakeAsync(() => {
    let answer: RoundCommandAnswer | undefined;
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => (answer = a));
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    expect(answer?.kind).toBe('ok');
    if (answer?.kind !== 'ok') return;
    expect(answer.changed).toBeTrue();
    expect(answer.round).toEqual(jasmine.objectContaining({ orderId: MOCK_FLOOR_IDS.freshHeldRound, state: 'released' }));
    expect(backend.round(MOCK_FLOOR_IDS.freshHeldRound)?.state).toBe('released');
  }));

  it('a resend is safe: the server answers changed: false', fakeAsync(() => {
    const answers: RoundCommandAnswer[] = [];
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => answers.push(a));
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => answers.push(a));
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    expect(answers[1].kind === 'ok' && answers[1].changed).toBeFalse();
  }));

  it('reads every 409 reason off the wire, with data.round', fakeAsync(() => {
    let reason = '';
    spyOn(backend, 'command').and.callFake(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { status: 409, message: 'm', reason, state: 'held', item_name: 'Rolex', data: { round: wireRound('held', { order_id: 'o-x' }) } },
          }),
      ),
    );
    for (reason of ROUND_REFUSAL_REASONS) {
      let answer: any;
      service.declineRound('r-1', 'o-x').subscribe(a => (answer = a));
      tick();
      expect(answer).toEqual(jasmine.objectContaining({ kind: 'refused', reason, state: 'held', itemName: 'Rolex' }));
      expect(answer.round).toEqual(jasmine.objectContaining({ orderId: 'o-x', state: 'held' }));
    }
  }));

  it('a 404 is GONE; any other failure, or a 200 about another order, is UNKNOWN', fakeAsync(() => {
    const answers: unknown[] = [];
    spyOn(backend, 'command').and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 404, error: { status: 404, message: 'Not found' } })),
      throwError(() => new HttpErrorResponse({ status: 500 })),
      throwError(() => new HttpErrorResponse({ status: 0 })),
      throwError(() => new HttpErrorResponse({ status: 403 })),
      of({ status: 200, message: 'ok', data: { round: wireRound('released', { order_id: 'someone-else' }), changed: true } }),
    );
    for (let i = 0; i < 5; i++) service.confirmRound('r-1', 'o-1').subscribe(a => answers.push(a));
    tick();
    expect(answers).toEqual([{ kind: 'gone' }, { kind: 'unknown' }, { kind: 'unknown' }, { kind: 'unknown' }, { kind: 'unknown' }]);
  }));

  it('a command that never answers is UNKNOWN after the timeout, never a failure', fakeAsync(() => {
    spyOn(backend, 'command').and.returnValue(NEVER);
    let answer: unknown;
    service.confirmRound('r-1', 'o-1').subscribe(a => (answer = a));
    tick(FLOOR_COMMAND_TIMEOUT_MS);
    expect(answer).toEqual({ kind: 'unknown' });
  }));

  it('C-2: at a suspended restaurant the reads and the commands all answer the one 404', fakeAsync(() => {
    backend.db.restaurant.lifecycle = 'suspended';
    let readErr: any;
    service.loadFloor('r-1').subscribe({ error: e => (readErr = e) });
    let answer: unknown;
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => (answer = a));
    tick(1_000);
    expect(readErr?.status).toBe(404);
    expect(answer).toEqual({ kind: 'gone' });
  }));

  it('THE FENCE: a read that STARTS before a command answer and LANDS after it is superseded', fakeAsync(() => {
    const reads: string[] = [];
    FloorMockBackend.READ_DELAY_MS = 2_000;
    service.loadFloor('r-1').subscribe(r => reads.push(r.kind)); // lands at 2000 ms
    FloorMockBackend.READ_DELAY_MS = 250;
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(); // lands at 600 ms
    tick(700);
    service.loadFloor('r-1').subscribe(r => reads.push(r.kind)); // starts after, lands at 950 ms
    tick(2_000);
    expect(reads).toEqual(['ok', 'superseded']);
  }));

  it('marks a table dirty, available or out of service on the mock', fakeAsync(() => {
    for (const status of ['dirty', 'out_of_service', 'available'] as const) {
      let answer: unknown;
      service.setTableStatus('r-1', MOCK_FLOOR_IDS.freeTable, status).subscribe(a => (answer = a));
      tick(FloorMockBackend.COMMAND_DELAY_MS);
      expect(answer).toEqual({ kind: 'ok' });
      expect(backend.table(MOCK_FLOOR_IDS.freeTable)?.status).toBe(status);
    }
  }));
});

/**
 * THE LIVE PATH, end to end below the component: the real `FloorService`, the real
 * `FloorHttpTransport`, the real `HttpClient` and the real `ErrorInterceptor`. Only the
 * server is stood in for (`HttpTestingController`), so these pin the routes, the
 * bodies, and what each failure becomes after the interceptor has seen it.
 */
describe('FloorService — the live HTTP transport through the real ErrorInterceptor', () => {
  let service: FloorService;
  let httpMock: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  const base = `${environment.apiUrl}/api/${environment.version}`;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warning', 'info', 'clear', 'dismiss']);
    const auth = jasmine.createSpyObj('AuthenticationService', ['logout', 'captureRequestOwner'], {
      userValue: { token: 't', profile: { id: 'u1' } },
    });
    auth.captureRequestOwner.and.returnValue(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: FLOOR_DEV_MODE, useValue: false },
        { provide: ToastService, useValue: toast },
        { provide: AuthenticationService, useValue: auth },
        { provide: Router, useValue: { url: '/dining-tables' } },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(FloorService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('reads GET floor/?restaurant= and GET floor/tables/<id>/?restaurant=', () => {
    service.loadFloor('r-1').subscribe();
    const f = httpMock.expectOne(r => r.url === `${base}/floor/`);
    expect(f.request.method).toBe('GET');
    expect(f.request.params.get('restaurant')).toBe('r-1');
    f.flush({});
    service.loadTable('r-1', 't-4').subscribe();
    const t = httpMock.expectOne(r => r.url === `${base}/floor/tables/t-4/`);
    expect(t.request.method).toBe('GET');
    expect(t.request.params.get('restaurant')).toBe('r-1');
    t.flush({});
  });

  it('a failing READ raises no toast — the floor is polled, and the view shows its own state', () => {
    let err: unknown;
    service.loadFloor('r-1').subscribe({ error: e => (err = e) });
    httpMock.expectOne(r => r.url === `${base}/floor/`).flush({ status: 404, message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    expect(err).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  for (const command of ['confirm', 'decline'] as const) {
    it(`${command}: POST floor/rounds/<id>/${command}/ with exactly {restaurant}`, () => {
      service.command('r-1', 'o-1', command).subscribe();
      const req = httpMock.expectOne(`${base}/floor/rounds/o-1/${command}/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ restaurant: 'r-1' });
      req.flush({ status: 200, message: 'ok', data: { round: wireRound(command === 'confirm' ? 'released' : 'declined'), changed: true } });
    });
  }

  it('a 409 reaches the service as a refusal with its reason and data.round, and no toast', () => {
    let answer: any;
    service.confirmRound('r-1', 'o-1').subscribe(a => (answer = a));
    httpMock.expectOne(`${base}/floor/rounds/o-1/confirm/`).flush(
      {
        status: 409, message: 'Something on this order cannot be made as ordered.', reason: 'cannot_be_made',
        state: 'held', item_name: 'Rolex', cannot_be_made: { reason: 'item_sold_out', item_name: 'Rolex' },
        data: { round: wireRound('held') },
      },
      { status: 409, statusText: 'Conflict' },
    );
    expect(answer).toEqual(jasmine.objectContaining({ kind: 'refused', reason: 'cannot_be_made', itemName: 'Rolex' }));
    expect(answer.round).toEqual(jasmine.objectContaining({ orderId: 'o-1', state: 'held' }));
    expect(answer.cannotBeMade).toEqual({ reason: 'item_sold_out', itemName: 'Rolex' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a 404 reaches the service as GONE, and no toast', () => {
    let answer: unknown;
    service.declineRound('r-1', 'o-1').subscribe(a => (answer = a));
    httpMock.expectOne(`${base}/floor/rounds/o-1/decline/`).flush({ status: 404, message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    expect(answer).toEqual({ kind: 'gone' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  describe('STATUS ACTIONS go to table-actions/update-status/', () => {
    for (const status of ['dirty', 'available', 'out_of_service'] as const) {
      it(`${status}: POST {table_id, status}, and the answer is read`, () => {
        let answer: StatusAnswer | undefined;
        service.setTableStatus('r-1', 't-4', status).subscribe(a => (answer = a));
        const req = httpMock.expectOne(`${base}/restaurant-setup/table-actions/update-status/`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({ table_id: 't-4', status });
        req.flush({ status: 200, message: 'Table status updated successfully', data: { id: 't-4', status } });
        expect(answer).toEqual({ kind: 'ok' });
      });
    }

    it('never touches the retired restaurant-setup/tables/ PUT', () => {
      service.setTableStatus('r-1', 't-4', 'dirty').subscribe();
      httpMock.expectNone(r => r.url.includes('restaurant-setup/tables'));
      const req = httpMock.expectOne(`${base}/restaurant-setup/table-actions/update-status/`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });

    it('a server refusal is REFUSED with the server’s words, and the interceptor stays silent (one toast, the view’s)', () => {
      let answer: StatusAnswer | undefined;
      service.setTableStatus('r-1', 't-4', 'dirty').subscribe(a => (answer = a));
      httpMock.expectOne(`${base}/restaurant-setup/table-actions/update-status/`).flush(
        { status: 404, message: 'Table not found' },
        { status: 404, statusText: 'Not Found' },
      );
      expect(answer).toEqual({ kind: 'refused', message: 'Table not found' });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('an answer about another table is UNKNOWN', () => {
      let answer: StatusAnswer | undefined;
      service.setTableStatus('r-1', 't-4', 'dirty').subscribe(a => (answer = a));
      httpMock.expectOne(`${base}/restaurant-setup/table-actions/update-status/`).flush({ status: 200, message: 'ok', data: { id: 't-9', status: 'dirty' } });
      expect(answer).toEqual({ kind: 'unknown' });
    });
  });
});
