import QRCode from 'qrcode';
import { generateQRPrintSheet } from './qr-print-sheet';
import { DiningArea, RestaurantTable } from '../models/tables.models';

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
      makeTable({ id: 'abc', number: 2, qrMode: 'order_pay' }),
      makeTable({ id: 'def', number: 1, qrMode: 'menu_only' }),
      makeTable({ id: 'no-qr', number: 3, hasQR: false }), // excluded
    ];

    await generateQRPrintSheet(tables, area);

    // Window is opened synchronously (popup-safe), exactly once.
    expect(openSpy).toHaveBeenCalledOnceWith('', '_blank');

    // One QR per QR-enabled table, each encoding the diner entry URL.
    const origin = window.location.origin;
    expect(toDataURLSpy).toHaveBeenCalledTimes(2);
    const encoded = toDataURLSpy.calls.allArgs().map(args => args[0]);
    expect(encoded).toContain(`${origin}/diner/h/abc?mode=order_pay`);
    expect(encoded).toContain(`${origin}/diner/h/def?mode=menu_only`);

    // The sheet embeds the locally-generated data URLs and never calls out.
    const html = fakeDoc.write.calls.mostRecent().args[0] as string;
    expect(html).toContain('data:image/png;base64,FAKEQR');
    expect(html).not.toContain('api.qrserver.com');
    expect(fakeDoc.close).toHaveBeenCalled();
  });

  it('opens nothing when no table in the area has a QR code', async () => {
    await generateQRPrintSheet([makeTable({ hasQR: false })], area);

    expect(openSpy).not.toHaveBeenCalled();
    expect(toDataURLSpy).not.toHaveBeenCalled();
  });
});
