import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import declaration from './checkout-record.storage.json';
import { AppModule } from '../app.module';
import { ApiService } from './api.service';
import {
  CHECKOUT_RECORD_VERSION, CheckoutCoordinatorService, PURCHASE_CANON,
} from './checkout-coordinator.service';

/**
 * D08 B1 (R2) — THE STORAGE DECLARATION IS THE CODE'S BEHAVIOUR, NOT A CLAIM BESIDE IT.
 *
 * `checkout-record.storage.json` states the (version, semantics) pairs this build
 * WRITES and can READ, and the release gate refuses to promote a build that cannot
 * read every pair the served build writes or reads. That rule is only as good as the
 * declaration, and a declaration is a sentence somebody wrote. This spec is what makes
 * it a checked sentence: it drives the REAL coordinator with a stored record of EVERY
 * declared read pair, and asserts the one property the whole barrier exists for —
 *
 *   an OUTSTANDING ISSUED COMMAND survives, UNDER THE SAME KEY.
 *
 * That is what "can read" has to mean here. A reader that parses a record and then
 * lets a changed basket mint a fresh key has read it and still created the duplicate
 * order the key exists to prevent.
 *
 * A DECLARED PAIR WITH NO FIXTURE FAILS. Adding `{version: 2, semantics: 2}` to
 * `reads` without adding the record it describes here is refused, so the declaration
 * cannot claim to read a shape nothing has ever proved it reads.
 *
 * THE FIXTURES ARE BYTES, NOT OBJECTS (Codex P2 on #687, reproduced). What an older
 * release left in a diner's browser is a STRING, under a PHYSICAL key, in the encoding
 * the storage service wrote it in. This spec used to seed its fixtures through the
 * current `SessionStorageService.setItem`, under a prefix of its own — so the writer
 * and the reader changed together, and a changed root prefix, key format or envelope
 * passed it (and the tripwire) while every stored record became invisible; measured,
 * the reader then answered `none` and minted a FRESH key for the same purchase while
 * the served build's command was still outstanding. Now the record is seeded as RAW
 * bytes, encoded by THIS spec's own statement of the declared encoding, at the
 * declared physical key — and the coordinator is built from the application's REAL
 * root configuration (`AppModule`), so the prefix it reads under is the one the app
 * actually uses.
 */

/**
 * The declared encodings, stated HERE rather than borrowed from the service under test.
 * `json-value-envelope` is what `StorageService.setItem` writes: `JSON.stringify({value})`.
 * A declared encoding with no entry is refused below — the declaration may not name a
 * byte format nothing has proved this build reads.
 */
const ENCODINGS: Record<string, { encode: (record: unknown) => string; decode: (raw: string) => unknown }> = {
  'json-value-envelope': {
    encode: (record) => JSON.stringify({ value: record }),
    decode: (raw) => (JSON.parse(raw) as { value: unknown }).value,
  },
};

describe('checkout record storage — the declared compatibility is the behaviour (D08 R2)', () => {
  let service: CheckoutCoordinatorService;

  const BASKET = JSON.stringify(['{"i":"i1","m":[],"e":[]}x2']);
  const OTHER_BASKET = JSON.stringify(['{"i":"i9","m":[],"e":[]}x1']);
  const CONTEXT = 'r1:t1';

  type Pair = { version: number; semantics: number };
  const pairKey = (p: Pair) => `${p.version}.${p.semantics}`;
  const encoding = () => ENCODINGS[declaration.encoding];
  /** Put bytes where an older release would have left them — never through the service. */
  const seedRaw = (record: unknown) => window.sessionStorage.setItem(declaration.physicalKey, encoding().encode(record));
  const raw = () => window.sessionStorage.getItem(declaration.physicalKey);

  /**
   * One stored record per declared read pair, each carrying an ISSUED command — the
   * state a rollback or a deploy must never strand.
   */
  const FIXTURES: Record<string, { stored: Record<string, unknown>; key: string; orderId: string }> = {
    // version 1: the UNVERSIONED D04/D (#663) shape. No `v`; `phase`, not `stage`.
    '1.1': {
      key: 'k-d04d',
      orderId: 'o-d04d',
      stored: {
        key: 'k-d04d', phase: 'submitting', orderId: 'o-d04d', quoteRef: 'q-d04d',
        basket: BASKET, context: CONTEXT, startedAt: 1,
      },
    },
    // version 2: CHECKOUT_RECORD_VERSION, as this build writes it.
    '2.1': {
      key: 'k-v2',
      orderId: 'o-v2',
      stored: {
        v: 2, key: 'k-v2', scope: CONTEXT,
        request: { identity: BASKET, canon: PURCHASE_CANON, items: [{ item: 'i1', quantity: 2 }] },
        stage: 'accepting',
        command: { orderId: 'o-v2', quoteRef: 'q-v2' },
        outcome: null, startedAt: 1, protocol: 3, quoteProtocol: 2,
        replaces: null, closure: null,
      },
    },
  };

  beforeEach(() => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: {} }) as never);
    // THE APPLICATION'S ROOT CONFIGURATION, not a prefix of this spec's choosing: the
    // storage prefix a served build wrote under is the one AppModule provides.
    TestBed.configureTestingModule({
      imports: [AppModule],
      providers: [{ provide: ApiService, useValue: api }],
    });
    service = TestBed.inject(CheckoutCoordinatorService);
    window.sessionStorage.removeItem(declaration.physicalKey);
  });

  afterEach(() => window.sessionStorage.removeItem(declaration.physicalKey));

  it('names the key and the store the coordinator actually uses', () => {
    expect(declaration.key).toBe(CheckoutCoordinatorService.ATTEMPT_KEY);
    expect(declaration.store).toBe('sessionStorage');
  });

  it('declares exactly the version this build writes', () => {
    expect(declaration.writes.version).toBe(CHECKOUT_RECORD_VERSION);
  });

  it('CONTRACT: the declared encoding is one this spec states — a byte format nothing proves is refused', () => {
    expect(encoding()).withContext(`declared encoding ${declaration.encoding} has no statement in this spec`).toBeDefined();
  });

  it('REGRESSION (Codex P2 on #687): a fresh checkout leaves its bytes at the declared PHYSICAL key, in the declared encoding', () => {
    // Through the REAL root configuration: a changed AppModule prefix, a changed key
    // format or a changed envelope each fail here, where they used to pass unseen.
    const reservation = service.reserveIntent({ identity: BASKET, canon: PURCHASE_CANON }, CONTEXT);
    expect(reservation.kind).toBe('ready');
    const bytes = raw();
    expect(bytes).withContext(`nothing was written at ${declaration.physicalKey}`).not.toBeNull();
    const record = encoding().decode(bytes as string) as Record<string, unknown>;
    expect(record['v']).toBe(declaration.writes.version);
    expect(encoding().encode(record)).withContext('the stored string is exactly the declared encoding of the record').toBe(bytes as string);
  });

  it('every declared read pair has a recovery fixture — a pair nothing proves is refused', () => {
    for (const pair of declaration.reads as Pair[]) {
      expect(FIXTURES[pairKey(pair)])
        .withContext(`declared read pair ${pairKey(pair)} has no fixture in this spec`)
        .toBeDefined();
    }
  });

  for (const pair of declaration.reads as Pair[]) {
    const fixture = FIXTURES[pairKey(pair)];
    if (!fixture) continue;

    it(`CONTRACT: the raw bytes of a stored ${pairKey(pair)} record are read with its issued command under the SAME key`, () => {
      seedRaw(fixture.stored);
      const stored = service.read();
      expect(stored.kind).toBe('record');
      if (stored.kind !== 'record') return;
      expect(stored.record.key).toBe(fixture.key);
      expect(stored.record.command?.orderId).toBe(fixture.orderId);
    });

    it(`CONTRACT: a changed basket cannot replace a stored ${pairKey(pair)} command — same-key recovery survives`, () => {
      seedRaw(fixture.stored);
      const reservation = service.reserveIntent({ identity: OTHER_BASKET, canon: PURCHASE_CANON }, CONTEXT);
      expect(reservation.kind).toBe('outstanding');
      const after = service.read();
      expect(after.kind === 'record' ? after.record.key : null).toBe(fixture.key);
    });
  }

  it('CONTROL: an UNDECLARED record version is unsupported and blocks — its bytes are never replaced', () => {
    const highest = Math.max(...(declaration.reads as Pair[]).map((p) => p.version));
    const future = { v: highest + 1, key: 'k-future', stage: 'accepting' };
    seedRaw(future);
    const before = raw();
    expect(service.read().kind).toBe('unsupported');
    expect(service.reserveIntent({ identity: BASKET, canon: PURCHASE_CANON }, CONTEXT).kind).toBe('blocked');
    expect(raw()).toBe(before);
  });

  it('CONTRACT: what a fresh checkout writes is the declared `writes` pair', () => {
    const reservation = service.reserveIntent({ identity: BASKET, canon: PURCHASE_CANON }, CONTEXT);
    expect(reservation.kind).toBe('ready');
    const record = encoding().decode(raw() as string) as Record<string, unknown>;
    expect(record['v']).toBe(declaration.writes.version);
    const pairs = (declaration.reads as Pair[]).map(pairKey);
    expect(pairs).toContain(pairKey(declaration.writes as Pair));
  });
});
