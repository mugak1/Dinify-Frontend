import QRCode from 'qrcode';
import { generateQRPrintSheet, getTableQRUrl } from './qr-print-sheet';
import { DiningArea, RestaurantTable } from '../models/tables.models';

function baseTable(over: Partial<RestaurantTable>): RestaurantTable {
  return {
    id: 't1',
    number: 1,
    minCapacity: 2,
    maxCapacity: 4,
    shape: 'square',
    status: 'available',
    tags: [],
    isActive: true,
    hasQR: true,
    qrMode: 'order_pay',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    ...over,
  };
}

/**
 * getTableQRUrl must FAIL CLOSED: a table without a usable credential can never
 * yield a `?c=` URL. This is the single chokepoint every render/copy/download/
 * open/print path flows through.
 */
describe('getTableQRUrl (fail-closed)', () => {
  const origin = window.location.origin;

  it('builds an encoded ?c= URL for a valid credential', () => {
    expect(getTableQRUrl(baseTable({ id: 'abc', qrCredential: 'CRED-abc' }))).toBe(
      `${origin}/diner/h/abc?c=CRED-abc`,
    );
  });

  it('percent-encodes a django-signing credential', () => {
    expect(getTableQRUrl(baseTable({ id: 'def', qrCredential: '.eyJ0Ijoi:sig' }))).toBe(
      `${origin}/diner/h/def?c=${encodeURIComponent('.eyJ0Ijoi:sig')}`,
    );
  });

  it('returns null for a missing credential', () => {
    expect(getTableQRUrl(baseTable({ qrCredential: undefined }))).toBeNull();
  });

  it('returns null for an empty credential', () => {
    expect(getTableQRUrl(baseTable({ qrCredential: '' }))).toBeNull();
  });

  it('returns null for a whitespace-only credential', () => {
    expect(getTableQRUrl(baseTable({ qrCredential: '   ' }))).toBeNull();
  });

  it('keeps the raw table id as an inert route hint (not authority)', () => {
    const url = getTableQRUrl(baseTable({ id: 'table-uuid', qrCredential: 'X' }))!;
    expect(url).toContain('/diner/h/table-uuid?c=');
  });

  it('never emits a ?c= URL with an empty value', () => {
    for (const c of [undefined, '', '   ']) {
      expect(getTableQRUrl(baseTable({ qrCredential: c as any }))).toBeNull();
    }
    const good = getTableQRUrl(baseTable({ qrCredential: 'Y' }))!;
    expect(good.endsWith('?c=')).toBeFalse();
  });
});

/**
 * The print sheet generates its QR codes locally with the bundled `qrcode`
 * library (no api.qrserver.com round-trip). These tests assert each table's
 * diner URL is encoded by the lib and that the rendered sheet embeds the
 * resulting data URLs with no external call.
 */
describe('generateQRPrintSheet (local QR generation)', () => {
  const area: DiningArea = {
    id: 'area-1',
    name: 'Main Hall',
    isIndoor: true,
    smokingAllowed: false,
    accessible: true,
    isActive: true,
    tableIds: [],
  };

  function makeTable(over: Partial<RestaurantTable>): RestaurantTable {
    return {
      id: 't1',
      number: 1,
      minCapacity: 2,
      maxCapacity: 4,
      shape: 'square',
      status: 'available',
      tags: [],
      isActive: true,
      hasQR: true,
      qrMode: 'order_pay',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      ...over,
    };
  }

  let fakeDoc: { write: jasmine.Spy; close: jasmine.Spy };
  let openSpy: jasmine.Spy;
  let toDataURLSpy: jasmine.Spy;

  beforeEach(() => {
    fakeDoc = {
      write: jasmine.createSpy('write'),
      close: jasmine.createSpy('close'),
    };
    openSpy = spyOn(window, 'open').and.returnValue(
      { document: fakeDoc } as unknown as Window,
    );
    // `toDataURL` is overloaded (one signature returns void), so jasmine infers
    // a void return for the spy — cast the resolved data URL past that.
    toDataURLSpy = spyOn(QRCode, 'toDataURL').and.returnValue(
      Promise.resolve('data:image/png;base64,FAKEQR') as unknown as void,
    );
  });

  it('encodes each table URL with the bundled lib and writes a sheet with no external call', async () => {
    const tables = [
      makeTable({ id: 'abc', number: 2, qrCredential: 'CRED-abc' }),
      // A real django-signing credential carries ':' separators (and a leading
      // '.' when compressed) — assert those are percent-encoded into the URL.
      makeTable({ id: 'def', number: 1, qrCredential: '.eyJ0Ijoi:sig-def' }),
      makeTable({ id: 'no-qr', number: 3, hasQR: false }), // excluded
    ];

    await generateQRPrintSheet(tables, area);

    // Window is opened synchronously (popup-safe), exactly once.
    expect(openSpy).toHaveBeenCalledOnceWith('', '_blank');

    // One QR per QR-enabled table, each encoding the diner entry URL with the
    // opaque credential in `?c=` (not the raw table UUID as authority).
    const origin = window.location.origin;
    expect(toDataURLSpy).toHaveBeenCalledTimes(2);
    const encoded = toDataURLSpy.calls.allArgs().map(args => args[0]);
    expect(encoded).toContain(`${origin}/diner/h/abc?c=CRED-abc`);
    expect(encoded).toContain(
      `${origin}/diner/h/def?c=${encodeURIComponent('.eyJ0Ijoi:sig-def')}`,
    );
    // The old raw ?mode= scheme is gone.
    expect(encoded.every(u => !u.includes('?mode='))).toBeTrue();

    // The sheet embeds the locally-generated data URLs and never calls out.
    const html = fakeDoc.write.calls.mostRecent().args[0] as string;
    expect(html).toContain('data:image/png;base64,FAKEQR');
    expect(html).not.toContain('api.qrserver.com');
    expect(fakeDoc.close).toHaveBeenCalled();
  });

  it('opens nothing when no table in the area has a QR code', async () => {
    const result = await generateQRPrintSheet([makeTable({ hasQR: false })], area);

    expect(openSpy).not.toHaveBeenCalled();
    expect(toDataURLSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ printed: 0, skipped: 0, opened: false });
  });

  it('excludes a QR-enabled table with no credential and reports it as skipped', async () => {
    const tables = [
      makeTable({ id: 'ok', number: 1, qrCredential: 'C' }),
      makeTable({ id: 'bad', number: 2, qrCredential: '' }), // hasQR but no credential
    ];

    const result = await generateQRPrintSheet(tables, area);

    expect(result.printed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.opened).toBeTrue();
    expect(toDataURLSpy).toHaveBeenCalledTimes(1);
    const encoded = toDataURLSpy.calls.allArgs().map(args => args[0]);
    expect(encoded).toContain(`${window.location.origin}/diner/h/ok?c=C`);
    // No empty-credential URL is ever generated.
    expect(encoded.every(u => !u.endsWith('?c='))).toBeTrue();
  });
});
