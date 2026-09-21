import { TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { TablesService } from './services/tables.service';
import { NewTableModalComponent } from './components/new-table-modal/new-table-modal.component';
import { BulkAddTablesModalComponent } from './components/bulk-add-tables-modal/bulk-add-tables-modal.component';
import {
  RestaurantTable,
  mapApiTable,
  readQrMode,
} from './models/tables.models';

/**
 * D07/PR-4 — WHAT A QR MODE CLAIMS, AND WHO IS ALLOWED TO INVENT ONE.
 *
 * `order_pay` names in-app payment collection. No code path in either repository
 * performs one: there is no aggregator integration, and the only payment writer
 * left refuses outright (501). So the DEFAULT had a table claiming a capability
 * the platform does not have, on every row nobody had configured.
 *
 * The rule this file pins is a CLASSIFICATION, because the same literal appeared
 * in two kinds of place and they call for opposite treatment:
 *
 *   NEW-FORM / RESET / CREATE-PAYLOAD sites choose a mode for a table that does
 *   not exist yet. They become `order_only` — truthful, and operationally
 *   identical, since both sit in the backend's `ORDERING_QR_MODES` whitelist.
 *
 *   MAPPING sites read an EXISTING row. They must RETAIN UNKNOWN. Defaulting
 *   there is worse than defaulting on create: it shows an operator a mode the
 *   table does not have, and an ordinary save then writes that guess back as
 *   though they had chosen it.
 *
 * `order_pay` IS NOT RETIRED. It stays a valid stored value, stays orderable,
 * and no row is rewritten — controls below pin each of those, because the easy
 * over-correction here is to treat a legacy value as an invalid one.
 */
describe('D07/PR-4 — qr_mode: truthful defaults, retained unknowns', () => {

  // ── the ONE reader ────────────────────────────────────────────────────────
  describe('readQrMode retains unknown', () => {
    it('returns a known mode unchanged — including the legacy one', () => {
      expect(readQrMode('menu_only')).toBe('menu_only');
      expect(readQrMode('order_only')).toBe('order_only');
      // CONTROL: the legacy mode is a VALID stored value, not a rejected one.
      expect(readQrMode('order_pay')).toBe('order_pay');
    });

    it('THE REGRESSION: an absent mode is undefined, never invented', () => {
      expect(readQrMode(undefined)).toBeUndefined();
      expect(readQrMode(null)).toBeUndefined();
      // It used to be `?? 'order_pay'` — the one mode that claims payment.
      expect(readQrMode(undefined)).not.toBe('order_pay');
    });

    it('an unrecognised mode is undefined too, and is not coerced', () => {
      // A future server mode reads as unknown here rather than as a known one.
      expect(readQrMode('order_and_tip')).toBeUndefined();
      expect(readQrMode('')).toBeUndefined();
      expect(readQrMode(7)).toBeUndefined();
    });
  });

  // ── mapping an existing row ───────────────────────────────────────────────
  describe('mapApiTable — a MAPPING site', () => {
    const row = (over: any = {}) => ({ id: 't1', number: 4, ...over });

    it('THE REGRESSION: a row with no qr_mode maps to undefined', () => {
      expect(mapApiTable(row()).qrMode).toBeUndefined();
      expect(mapApiTable(row()).qrMode).not.toBe('order_pay');
    });

    it('CONTROL: a stored legacy mode still maps through unchanged', () => {
      expect(mapApiTable(row({ qr_mode: 'order_pay' })).qrMode).toBe('order_pay');
    });

    it('CONTROL: every other mapped field is untouched by this change', () => {
      const t = mapApiTable(row({ qr_mode: 'order_only', has_qr: true, number: 9 }));
      expect(t.qrMode).toBe('order_only');
      expect(t.hasQR).toBeTrue();
      expect(t.number).toBe(9);
    });
  });

  // ── the create paths ──────────────────────────────────────────────────────
  describe('NEW tables default to order_only', () => {
    it('the new-table modal seeds a create form with order_only', () => {
      const c = new NewTableModalComponent();
      c.table = null;
      c.open = true;
      c.ngOnChanges({ open: new SimpleChange(false, true, true) });
      expect(c.qrMode).toBe('order_only');
    });

    it('the bulk-add modal seeds with order_only', () => {
      expect(new BulkAddTablesModalComponent().qrMode).toBe('order_only');
    });

    it('a create emits the default rather than the legacy mode', () => {
      const c = new NewTableModalComponent();
      c.table = null;
      c.open = true;
      c.ngOnChanges({ open: new SimpleChange(false, true, true) });
      c.number = 7;
      c.maxCapacity = 4;
      c.generateQR = true;

      let emitted!: Partial<RestaurantTable>;
      c.saved.subscribe(v => (emitted = v));
      c.onSubmit();

      expect(emitted.qrMode).toBe('order_only');
    });
  });

  // ── editing an existing row ───────────────────────────────────────────────
  describe('EDIT of a table whose stored mode is unknown', () => {
    function editing(table: Partial<RestaurantTable>): NewTableModalComponent {
      const c = new NewTableModalComponent();
      // `maxCapacity` is real fixture data, not padding: `onSubmit` returns
      // early without it, so a table lacking one would make every assertion
      // below vacuous.
      c.table = {
        id: 't1', number: 5, tags: [], minCapacity: 2, maxCapacity: 4,
        shape: 'square', isActive: true, ...table,
      } as RestaurantTable;
      c.open = true;
      c.ngOnChanges({ open: new SimpleChange(false, true, true) });
      return c;
    }

    it('THE REGRESSION: prefills nothing, so no guess is shown', () => {
      const c = editing({ hasQR: true, qrMode: undefined });
      expect(c.qrMode).toBeUndefined();
    });

    it('and emits no qr_mode, so an unrelated edit preserves the server value', () => {
      const c = editing({ hasQR: true, qrMode: undefined });
      c.maxCapacity = 6;                       // the operator changed something else

      let emitted!: Partial<RestaurantTable>;
      c.saved.subscribe(v => (emitted = v));
      c.onSubmit();

      expect(emitted.maxCapacity).toBe(6);
      expect(emitted.qrMode).toBeUndefined();
    });

    it('CONTROL: an existing legacy table still prefills and re-emits its own mode', () => {
      const c = editing({ hasQR: true, qrMode: 'order_pay' });
      expect(c.qrMode).toBe('order_pay');

      let emitted!: Partial<RestaurantTable>;
      c.saved.subscribe(v => (emitted = v));
      c.onSubmit();

      expect(emitted.qrMode).toBe('order_pay');
    });
  });

  // ── the wire ──────────────────────────────────────────────────────────────
  describe('the create payload on the wire', () => {
    let service: TablesService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
      });
      service = TestBed.inject(TablesService);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    function createdPayload(data: Partial<RestaurantTable>): any {
      service.createTable(data, 'r1').subscribe({ next: () => {}, error: () => {} });
      const req = httpMock.expectOne(r => r.url.includes('restaurant-setup/tables/'));
      const body = req.request.body;
      req.flush({ status: 200, data: {} });
      return body;
    }

    it('THE REGRESSION: a create with no mode sends order_only', () => {
      expect(createdPayload({ number: 3 }).qr_mode).toBe('order_only');
    });

    it('CONTROL: an explicit mode is sent verbatim, legacy included', () => {
      expect(createdPayload({ number: 3, qrMode: 'menu_only' }).qr_mode).toBe('menu_only');
      expect(createdPayload({ number: 4, qrMode: 'order_pay' }).qr_mode).toBe('order_pay');
    });

    it('an UPDATE omits qr_mode entirely when it is undefined', () => {
      // This is what makes "retain unknown" reach the server as "leave it alone"
      // rather than as a blank that overwrites.
      service.updateTable({ id: 't1', maxCapacity: 6 }).subscribe({
        next: () => {}, error: () => {},
      });
      const req = httpMock.expectOne(r => r.url.includes('restaurant-setup/tables/'));
      expect('qr_mode' in req.request.body).toBeFalse();
      expect(req.request.body.max_capacity).toBe(6);
      req.flush({ status: 200, data: {} });
    });
  });
});
