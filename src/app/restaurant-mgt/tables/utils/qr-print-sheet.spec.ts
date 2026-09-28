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

/**
 * D14 B1 — operator-supplied labels reach the print document as TEXT.
 *
 * The sheet is written with `document.write` into a same-origin popup, so every
 * dynamic label is HTML-encoded where it is interpolated. These tests parse the
 * document the helper actually wrote (DOMParser executes nothing) and assert on
 * the resulting DOM — title, text and element structure — rather than on
 * substrings: a harmless marker element and title-closing content must stay
 * literal text, with no injected element or attribute.
 */
describe('generateQRPrintSheet (dynamic labels are encoded as text)', () => {
  const MARKER = '<dinify-probe data-d14="x">m</dinify-probe>';
  const TITLE_BREAK = '</title><dinify-probe data-d14="t"></dinify-probe>';

  function areaNamed(name: string): DiningArea {
    return {
      id: 'area-1',
      name,
      isIndoor: true,
      smokingAllowed: false,
      accessible: true,
      isActive: true,
      tableIds: [],
    };
  }

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
      qrMode: 'order_only',
      qrCredential: 'CRED-1',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      ...over,
    };
  }

  let fakeDoc: { write: jasmine.Spy; close: jasmine.Spy };
  let openSpy: jasmine.Spy;

  beforeEach(() => {
    fakeDoc = {
      write: jasmine.createSpy('write'),
      close: jasmine.createSpy('close'),
    };
    openSpy = spyOn(window, 'open').and.returnValue(
      { document: fakeDoc } as unknown as Window,
    );
    spyOn(QRCode, 'toDataURL').and.returnValue(
      Promise.resolve('data:image/png;base64,FAKEQR') as unknown as void,
    );
  });

  /** Parse the document the sheet wrote. DOMParser runs no script. */
  function writtenDocument(): Document {
    expect(fakeDoc.write).toHaveBeenCalledTimes(1);
    const html = fakeDoc.write.calls.mostRecent().args[0] as string;
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function noInjectedMarkup(doc: Document): void {
    expect(doc.querySelector('dinify-probe')).toBeNull();
    expect(doc.querySelector('[data-d14]')).toBeNull();
  }

  it('REGRESSION: an area name is literal text in the title, the header and every card', async () => {
    const tables = [
      makeTable({ id: 'a', number: 1 }),
      makeTable({ id: 'b', number: 2 }),
    ];

    await generateQRPrintSheet(tables, areaNamed(`Patio ${MARKER}`));

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    expect(doc.title).toBe(`QR Codes – Patio ${MARKER}`);
    expect(doc.querySelector('.header h1')!.textContent).toBe(`Patio ${MARKER} – QR Codes`);
    const cardAreas = Array.from(doc.querySelectorAll('.card .area-name'));
    expect(cardAreas.length).toBe(2);
    for (const el of cardAreas) {
      expect(el.textContent).toBe(`Patio ${MARKER}`);
      expect(el.children.length).toBe(0);
    }
  });

  it('REGRESSION: title-closing content in the area name cannot leave the <title>', async () => {
    await generateQRPrintSheet([makeTable({})], areaNamed(`Bar ${TITLE_BREAK}`));

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    expect(doc.title).toBe(`QR Codes – Bar ${TITLE_BREAK}`);
    expect(doc.head.querySelectorAll('title').length).toBe(1);
    // The sheet's own structure is intact: exactly one header and one card.
    expect(doc.querySelectorAll('.header').length).toBe(1);
    expect(doc.querySelectorAll('.card').length).toBe(1);
  });

  it('REGRESSION: a table displayName is literal text on its card', async () => {
    await generateQRPrintSheet(
      [makeTable({ id: 'a', number: 4, displayName: `Window ${MARKER}` })],
      areaNamed('Main Hall'),
    );

    const doc = writtenDocument();
    noInjectedMarkup(doc);
    const label = doc.querySelector('.card .table-number')!;
    expect(label.textContent).toBe(`Table Window ${MARKER}`);
    expect(label.children.length).toBe(0);
  });

  it('falls back to the table number when displayName is empty, keeping numeric presentation', async () => {
    await generateQRPrintSheet(
      [
        makeTable({ id: 'a', number: 7, displayName: '' }),
        makeTable({ id: 'b', number: 12, displayName: undefined }),
      ],
      areaNamed('Main Hall'),
    );

    const doc = writtenDocument();
    const labels = Array.from(doc.querySelectorAll('.card .table-number')).map(e => e.textContent);
    // Cards are sorted by number; the fallback is the number itself.
    expect(labels).toEqual(['Table 7', 'Table 12']);
    const alts = Array.from(doc.querySelectorAll('.card img')).map(i => i.getAttribute('alt'));
    expect(alts).toEqual(['QR code for table 7', 'QR code for table 12']);
  });

  it('keeps a falsy table number 0 as the fallback label under the current contract', async () => {
    await generateQRPrintSheet(
      [makeTable({ id: 'z', number: 0, displayName: '' })],
      areaNamed('Main Hall'),
    );

    const doc = writtenDocument();
    expect(doc.querySelector('.card .table-number')!.textContent).toBe('Table 0');
  });

  it('preserves ordinary names, Unicode, quotes, ampersands and entity-looking text as displayed text', async () => {
    const name = `Café "Ndiizi" & Friends' Deck — &amp; 🍌`;
    await generateQRPrintSheet(
      [makeTable({ id: 'a', number: 1, displayName: `Bürgers & "Bites"` })],
      areaNamed(name),
    );

    const doc = writtenDocument();
    expect(doc.title).toBe(`QR Codes – ${name}`);
    expect(doc.querySelector('.header h1')!.textContent).toBe(`${name} – QR Codes`);
    expect(doc.querySelector('.card .area-name')!.textContent).toBe(name);
    expect(doc.querySelector('.card .table-number')!.textContent).toBe(`Table Bürgers & "Bites"`);
  });

  it('keeps the trusted local QR data URL and the credential unmodified', async () => {
    const credential = '.eyJ0Ijoi:sig-<&>"';
    const result = await generateQRPrintSheet(
      [makeTable({ id: 'abc', number: 3, qrCredential: credential })],
      areaNamed(`Patio ${MARKER}`),
    );

    expect(result).toEqual({ printed: 1, skipped: 0, opened: true });
    const encodedUrl = (QRCode.toDataURL as unknown as jasmine.Spy).calls.mostRecent().args[0];
    expect(encodedUrl).toBe(
      `${window.location.origin}/diner/h/abc?c=${encodeURIComponent(credential)}`,
    );
    const doc = writtenDocument();
    expect(doc.querySelector('.card img')!.getAttribute('src')).toBe('data:image/png;base64,FAKEQR');
    expect(doc.querySelector('.card .seats')!.textContent).toBe('4 seats · square');
  });

  it('counts printable and skipped rows with an encoded area name, and writes only printable cards', async () => {
    const result = await generateQRPrintSheet(
      [
        makeTable({ id: 'ok-1', number: 1 }),
        makeTable({ id: 'ok-2', number: 2, displayName: MARKER }),
        makeTable({ id: 'no-cred', number: 3, qrCredential: '' }),
        makeTable({ id: 'no-qr', number: 4, hasQR: false }),
      ],
      areaNamed(MARKER),
    );

    expect(result).toEqual({ printed: 2, skipped: 1, opened: true });
    const doc = writtenDocument();
    noInjectedMarkup(doc);
    expect(doc.querySelectorAll('.card').length).toBe(2);
    expect(doc.querySelector('.header p')!.textContent).toContain('2 tables');
  });

  it('returns opened:false and writes nothing when the popup is blocked', async () => {
    openSpy.and.returnValue(null);

    const result = await generateQRPrintSheet([makeTable({})], areaNamed(MARKER));

    expect(result).toEqual({ printed: 1, skipped: 0, opened: false });
    expect(fakeDoc.write).not.toHaveBeenCalled();
  });
});
