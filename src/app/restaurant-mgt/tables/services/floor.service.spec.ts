import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FloorService } from './floor.service';
import { FloorMockBackend } from './floor-mock-backend';
import { FLOOR_DEV_MODE } from './floor-view-gate';
import { MOCK_FLOOR_IDS } from '../data/floor-mock-data';
import { ROUND_REFUSAL_REASONS } from '../models/floor.models';

const CLOCK = Date.parse('2026-11-03T16:00:00Z');

function setUp(devMode: boolean): { service: FloorService; backend: FloorMockBackend } {
  TestBed.configureTestingModule({ providers: [{ provide: FLOOR_DEV_MODE, useValue: devMode }] });
  const backend = TestBed.inject(FloorMockBackend);
  backend.clock = () => CLOCK;
  return { service: TestBed.inject(FloorService), backend };
}

describe('FloorService — which transport answers', () => {
  afterEach(() => (FloorService.USE_MOCK_DATA = true));

  it('serves the mock floor in a development build while USE_MOCK_DATA is on', fakeAsync(() => {
    const { service } = setUp(true);
    let kind = '';
    service.loadFloor('r-1').subscribe(r => (kind = r.kind));
    tick(FloorMockBackend.READ_DELAY_MS);
    expect(kind).toBe('ok');
  }));

  it('PRODUCTION GATE (defence in depth): never serves mock tables outside a development build', fakeAsync(() => {
    const { service, backend } = setUp(false);
    const reads = ['getFloor', 'getTable', 'command', 'setTableStatus'].map(m => spyOn(backend, m as never).and.callThrough());
    let error: unknown = null;
    let value: unknown = null;
    service.loadFloor('r-1').subscribe({ next: v => (value = v), error: e => (error = e) });
    service.loadTable('r-1', MOCK_FLOOR_IDS.freshHeldTable).subscribe({ error: () => undefined });
    let answer: unknown = null;
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => (answer = a));
    tick(5_000);
    expect(value).toBeNull();
    expect(String(error)).toContain('never served outside a development build');
    expect(answer).toEqual({ kind: 'unknown' });
    for (const spy of reads) expect(spy).not.toHaveBeenCalled();
  }));

  it('with USE_MOCK_DATA off, fails loudly until FE-C wires the real endpoints', fakeAsync(() => {
    const { service, backend } = setUp(true);
    FloorService.USE_MOCK_DATA = false;
    const spy = spyOn(backend, 'getFloor').and.callThrough();
    let error: unknown = null;
    service.loadFloor('r-1').subscribe({ error: e => (error = e) });
    tick();
    expect(String(error)).toContain('FE-C');
    expect(spy).not.toHaveBeenCalled();
  }));
});

describe('FloorService — answers', () => {
  let service: FloorService;
  let backend: FloorMockBackend;

  beforeEach(() => ({ service, backend } = setUp(true)));

  it('confirms a held round: the answer names it and says it changed', fakeAsync(() => {
    let answer: unknown;
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => (answer = a));
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    expect(answer).toEqual({ kind: 'ok', changed: true, orderId: MOCK_FLOOR_IDS.freshHeldRound, state: 'released' });
    expect(backend.round(MOCK_FLOOR_IDS.freshHeldRound)?.state).toBe('released');
  }));

  it('a resend is safe: the server answers changed: false', fakeAsync(() => {
    const answers: unknown[] = [];
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => answers.push(a));
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    service.confirmRound('r-1', MOCK_FLOOR_IDS.freshHeldRound).subscribe(a => answers.push(a));
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    expect((answers[1] as { changed: boolean }).changed).toBeFalse();
  }));

  it('reads every 409 reason off the wire', fakeAsync(() => {
    let reason: string = '';
    spyOn(backend, 'command').and.callFake(() =>
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { status: 409, message: 'm', reason, state: 'held', item_name: 'Rolex' } }),
      ),
    );
    for (reason of ROUND_REFUSAL_REASONS) {
      let answer: any;
      service.declineRound('r-1', 'o-x').subscribe(a => (answer = a));
      tick();
      expect(answer).toEqual({ kind: 'refused', reason, message: 'm', state: 'held', itemName: 'Rolex' });
    }
  }));

  it('a non-409 failure or a 200 about another order is UNKNOWN, never success or failure', fakeAsync(() => {
    const answers: unknown[] = [];
    spyOn(backend, 'command').and.returnValues(
      throwError(() => new HttpErrorResponse({ status: 500 })),
      throwError(() => new HttpErrorResponse({ status: 0 })),
      of({ status: 200, message: 'ok', data: { round: { order_id: 'someone-else', state: 'released' }, changed: true } }),
    );
    for (let i = 0; i < 3; i++) service.confirmRound('r-1', 'o-1').subscribe(a => answers.push(a));
    tick();
    expect(answers).toEqual([{ kind: 'unknown' }, { kind: 'unknown' }, { kind: 'unknown' }]);
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
    // The later read lands first and is applied; the older one lands after the answer
    // and would reinstate the pre-command floor, so it is reported superseded.
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
