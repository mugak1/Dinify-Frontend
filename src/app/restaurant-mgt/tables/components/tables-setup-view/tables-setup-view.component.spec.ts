import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import QRCode from 'qrcode';
import { TablesSetupViewComponent } from './tables-setup-view.component';
import { BulkTablesConfig } from '../bulk-add-tables-modal/bulk-add-tables-modal.component';

/**
 * Deletion-block error handling (Leg 4). The backend returns HTTP 409 with a
 * specific message when an area still has tables or a table has an open order;
 * the error interceptor re-throws that message as a plain string. The confirm
 * handlers must surface it (no false success, no blank toast) and only report
 * success once the delete actually succeeds.
 */
describe('TablesSetupViewComponent — deletion block error handling', () => {
  let component: TablesSetupViewComponent;
  let tablesService: any;
  let toast: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'deleteArea', 'deleteTable', 'getAreas', 'getTables',
    ]);
    // refresh() chains getAreas -> getTables on success; keep them inert.
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth);
  });

  // ── area delete ───────────────────────────────────────────────────────
  it('surfaces the backend block message when an area delete is rejected', () => {
    const blockMsg = 'Move or remove the 3 table(s) in this area before deleting it.';
    tablesService.deleteArea.and.returnValue(throwError(() => blockMsg));
    component.deleteAreaTarget = { id: 'a1' } as any;

    component.confirmDeleteArea();

    expect(toast.error).toHaveBeenCalledWith(blockMsg);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.clear).toHaveBeenCalled(); // interceptor toast suppressed
  });

  it('reports area success only after the delete actually succeeds', () => {
    tablesService.deleteArea.and.returnValue(of(null));
    component.deleteAreaTarget = { id: 'a1' } as any;

    component.confirmDeleteArea();

    expect(toast.success).toHaveBeenCalledWith('Area deleted');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('falls back to a clear message when the area error carries none', () => {
    tablesService.deleteArea.and.returnValue(throwError(() => ({})));
    component.deleteAreaTarget = { id: 'a1' } as any;

    component.confirmDeleteArea();

    expect(toast.error).toHaveBeenCalledWith(
      'Could not delete this area. Please try again.',
    );
  });

  // ── table delete ──────────────────────────────────────────────────────
  it('surfaces the backend block message when a table delete is rejected', () => {
    const blockMsg =
      'This table has an open order — settle it before removing the table.';
    tablesService.deleteTable.and.returnValue(throwError(() => blockMsg));
    component.deleteTableTarget = { id: 't1' } as any;

    component.confirmDeleteTable();

    expect(toast.error).toHaveBeenCalledWith(blockMsg);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.clear).toHaveBeenCalled();
  });

  it('reports table success only after the delete actually succeeds', () => {
    tablesService.deleteTable.and.returnValue(of(null));
    component.deleteTableTarget = { id: 't1' } as any;

    component.confirmDeleteTable();

    expect(toast.success).toHaveBeenCalledWith('Table deleted');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('extracts a structured { error: { message } } body', () => {
    tablesService.deleteTable.and.returnValue(
      throwError(() => ({ error: { message: 'boom' } })),
    );
    component.deleteTableTarget = { id: 't1' } as any;

    component.confirmDeleteTable();

    expect(toast.error).toHaveBeenCalledWith('boom');
  });
});

/**
 * Bulk "Add multiple tables" flow. The component computes the create/skip split
 * against its own live table list, fans the create-able numbers out through
 * tablesService.bulkCreateTables, and surfaces a single aggregate toast that
 * reports created, skipped (already-existing) and failed numbers.
 */
describe('TablesSetupViewComponent — bulk add tables', () => {
  let component: TablesSetupViewComponent;
  let tablesService: any;
  let toast: any;

  const config = (over: Partial<BulkTablesConfig> = {}): BulkTablesConfig => ({
    start: 1,
    count: 4,
    minCapacity: 2,
    maxCapacity: 4,
    shape: 'square',
    generateQR: false,
    qrMode: 'order_pay',
    ...over,
  });

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'bulkCreateTables', 'getAreas', 'getTables',
    ]);
    // refresh() chains getAreas -> getTables on success; keep them inert.
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    tablesService.bulkCreateTables.and.returnValue(of([]));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth);
  });

  it('creates only the non-existing numbers and reports created + skipped', () => {
    component.tables = [{ number: 1 }, { number: 2 }] as any;
    tablesService.bulkCreateTables.and.returnValue(
      of([{ number: 3, ok: true }, { number: 4, ok: true }]),
    );

    component.onBulkTablesSaved(config({ start: 1, count: 4 }));

    const [specs, restaurantId] = tablesService.bulkCreateTables.calls.mostRecent().args;
    expect(specs.map((s: any) => s.number)).toEqual([3, 4]); // 1 & 2 skipped
    expect(restaurantId).toBe('r1');

    const msg = toast.success.calls.mostRecent().args[0];
    expect(msg).toContain('Created 2');
    expect(msg).toContain('skipped 2 already-existing: 1, 2');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('builds specs from the shared defaults and the area + QR toggle', () => {
    component.tables = [] as any;

    component.onBulkTablesSaved(
      config({ start: 5, count: 2, areaId: 'a1', generateQR: true, qrMode: 'menu_only' }),
    );

    const specs = tablesService.bulkCreateTables.calls.mostRecent().args[0];
    expect(specs.length).toBe(2);
    expect(specs[0]).toEqual(jasmine.objectContaining({
      number: 5, areaId: 'a1', minCapacity: 2, maxCapacity: 4,
      shape: 'square', isActive: true, hasQR: true, qrMode: 'menu_only',
    }));
  });

  it('clears the global banner and reports failures when some creates fail', () => {
    component.tables = [] as any;
    tablesService.bulkCreateTables.and.returnValue(
      of([{ number: 3, ok: true }, { number: 4, ok: false }]),
    );

    component.onBulkTablesSaved(config({ start: 3, count: 2 }));

    expect(toast.clear).toHaveBeenCalled();
    const msg = toast.error.calls.mostRecent().args[0];
    expect(msg).toContain('Created 1');
    expect(msg).toContain('1 failed: 4');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does nothing but warn when every number in the range already exists', () => {
    component.tables = [{ number: 1 }, { number: 2 }] as any;
    component.isBulkTableModalOpen = true;

    component.onBulkTablesSaved(config({ start: 1, count: 2 }));

    expect(tablesService.bulkCreateTables).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('No new table numbers to create.');
    expect(component.isBulkTableModalOpen).toBeFalse();
  });
});

/**
 * Honest success/error feedback for the create / update / toggle / move actions
 * (M2). Before the fix these fired toast.success synchronously, regardless of the
 * service outcome — a false "success" plus the interceptor's own error toast. They
 * must now mirror the delete/bulk paths: report success ONLY inside the subscribe
 * callback, and surface a single clean error (toast.clear() + toast.error) on
 * failure.
 */
describe('TablesSetupViewComponent — honest mutation feedback', () => {
  let component: TablesSetupViewComponent;
  let tablesService: any;
  let toast: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'createArea', 'updateArea', 'createTable', 'updateTable',
      'bulkUpdateTables', 'moveTableToArea', 'getAreas', 'getTables',
    ]);
    // The post-mutation refresh() chains getAreas -> getTables; keep them inert.
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth);
  });

  // ── create / update area (single call) ────────────────────────────────
  it('does not report success when creating an area fails', () => {
    tablesService.createArea.and.returnValue(throwError(() => 'Network error'));

    component.onAreaSaved({ name: 'Patio' } as any);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Network error');
    expect(toast.clear).toHaveBeenCalled();
  });

  it('reports area-created success only after the create succeeds', () => {
    tablesService.createArea.and.returnValue(of({ id: 'a1' }));

    component.onAreaSaved({ name: 'Patio' } as any);

    expect(toast.success).toHaveBeenCalledOnceWith('Area created');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not report success when updating an area fails', () => {
    tablesService.updateArea.and.returnValue(throwError(() => 'boom'));
    component.editingArea = { id: 'a1' } as any;

    component.onAreaSaved({ name: 'Main' } as any);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  // ── create / update table (single call) ───────────────────────────────
  it('reports table-created success only after the create succeeds', () => {
    tablesService.createTable.and.returnValue(of({ id: 't1' }));

    component.onTableSaved({ number: 7 } as any);

    expect(toast.success).toHaveBeenCalledOnceWith('Table created');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not report success when creating a table fails', () => {
    tablesService.createTable.and.returnValue(throwError(() => 'table boom'));

    component.onTableSaved({ number: 7 } as any);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('table boom');
    expect(toast.clear).toHaveBeenCalled();
  });

  // ── table toggle (single call) ────────────────────────────────────────
  it('reports the table toggle success only after it succeeds', () => {
    tablesService.updateTable.and.returnValue(of(null));

    component.handleTableActiveToggle({ id: 't1', number: 5, isActive: false } as any);

    expect(toast.success).toHaveBeenCalledOnceWith('Table 5 enabled');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not report success when a table toggle fails', () => {
    tablesService.updateTable.and.returnValue(throwError(() => 'nope'));

    component.handleTableActiveToggle({ id: 't1', number: 5, isActive: true } as any);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('nope');
    expect(toast.clear).toHaveBeenCalled();
  });

  // ── area toggle (forkJoin: area + each of its tables) ─────────────────
  it('reports the area toggle success only after every call succeeds', () => {
    tablesService.updateArea.and.returnValue(of(null));
    tablesService.updateTable.and.returnValue(of(null));
    component.tables = [
      { id: 't1', areaId: 'a1', isActive: true },
      { id: 't2', areaId: 'a1', isActive: true },
    ] as any;

    component.handleAreaActiveToggle({ id: 'a1', name: 'Main Hall', isActive: true } as any);

    expect(tablesService.updateTable).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledOnceWith('Main Hall closed');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('surfaces a single error when the area toggle fails', () => {
    tablesService.updateArea.and.returnValue(throwError(() => 'area down'));
    tablesService.updateTable.and.returnValue(of(null));
    component.tables = [{ id: 't1', areaId: 'a1', isActive: true }] as any;

    component.handleAreaActiveToggle({ id: 'a1', name: 'Main Hall', isActive: true } as any);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('area down');
    expect(toast.clear).toHaveBeenCalled();
  });

  // ── bulk action (forkJoin via bulkUpdateTables) ───────────────────────
  it('reports the bulk-enable success only after it succeeds', () => {
    tablesService.bulkUpdateTables.and.returnValue(of([null, null]));
    component.selectedTableIds = ['t1', 't2'];

    component.handleBulkAction('enable');

    expect(tablesService.bulkUpdateTables).toHaveBeenCalledWith(
      ['t1', 't2'], { isActive: true },
    );
    expect(toast.success).toHaveBeenCalledOnceWith('2 table(s) enabled');
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.selectedTableIds).toEqual([]);
  });

  it('does not report success when a bulk action fails', () => {
    tablesService.bulkUpdateTables.and.returnValue(throwError(() => 'bulk boom'));
    component.selectedTableIds = ['t1', 't2'];

    component.handleBulkAction('disable');

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('bulk boom');
    expect(toast.clear).toHaveBeenCalled();
  });

  // ── move tables (forkJoin via moveTableToArea) ────────────────────────
  it('reports the move success only after it succeeds', () => {
    tablesService.moveTableToArea.and.returnValue(of([null]));
    component.areas = [{ id: 'a1', name: 'Patio' }] as any;
    component.moveSelectedTableIds = ['t1'];
    component.moveTargetAreaId = 'a1';

    component.confirmMoveTables();

    expect(toast.success).toHaveBeenCalledOnceWith('1 table(s) moved to Patio');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not report success when the move fails', () => {
    tablesService.moveTableToArea.and.returnValue(throwError(() => 'move boom'));
    component.areas = [{ id: 'a1', name: 'Patio' }] as any;
    component.moveSelectedTableIds = ['t1'];
    component.moveTargetAreaId = 'a1';

    component.confirmMoveTables();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('move boom');
    expect(toast.clear).toHaveBeenCalled();
  });
});

/**
 * Initial-load loading/error state (M4). Data renders from a combineLatest over the
 * service's areas$/tables$ subjects, but the GET that fills them lives in refresh().
 * Before the fix a failed first load left the view blank with no indication. refresh()
 * now raises a loading flag and captures a loadError that the template surfaces with a
 * Retry button.
 */
describe('TablesSetupViewComponent — initial load state', () => {
  let component: TablesSetupViewComponent;
  let tablesService: any;
  let toast: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', ['getAreas', 'getTables']);
    // ngOnInit's combineLatest subscribes to these subjects directly.
    tablesService.areas$ = new BehaviorSubject<any[]>([]);
    tablesService.tables$ = new BehaviorSubject<any[]>([]);
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth);
  });

  it('captures a load error and stops loading when the initial load fails', () => {
    tablesService.getAreas.and.returnValue(throwError(() => 'Server unavailable'));

    component.ngOnInit();

    expect(component.loadError).toBe('Server unavailable');
    expect(component.loading).toBeFalse();
  });

  it('clears the loading flag and error on a successful load', () => {
    component.ngOnInit();

    expect(component.loading).toBeFalse();
    expect(component.loadError).toBeNull();
  });

  it('retries the load when reload() is called after a failure', () => {
    tablesService.getAreas.and.returnValue(throwError(() => 'down'));
    component.ngOnInit();
    expect(component.loadError).toBe('down');

    // Backend recovers; the Retry button calls reload().
    tablesService.getAreas.and.returnValue(of([]));
    component.reload();

    expect(component.loadError).toBeNull();
    expect(component.loading).toBeFalse();
  });
});

/**
 * Secure single-table QR rotation. The parent owns the confirmation + mutation:
 * a double-click issues exactly one request, success swaps in the server
 * credential and shows one toast + notice, and failure leaves the old QR active.
 */
describe('TablesSetupViewComponent — secure QR rotation', () => {
  let component: TablesSetupViewComponent;
  let tablesService: any;
  let toast: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'regenerateTableQr', 'activateQrForTables', 'getAreas', 'getTables',
    ]);
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    tablesService.tables$ = new BehaviorSubject<any[]>([]);
    toast = jasmine.createSpyObj('ToastService', [
      'success', 'error', 'warning', 'info', 'clear',
    ]);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth);
  });

  it('opens the confirmation for the right table (row action)', () => {
    const t = { id: 't1', number: 5 } as any;
    component.openRotateConfirm(t);
    expect(component.confirmRotateTable).toBe(t);
    expect(component.rotateAck).toBeFalse();
  });

  it('routes the preview-modal request through the same confirmation', () => {
    const t = { id: 't2', number: 6 } as any;
    // The template binds (regenerateRequested) to openRotateConfirm.
    component.openRotateConfirm(t);
    expect(component.confirmRotateTable).toBe(t);
  });

  it('does not call the service on cancel', () => {
    component.confirmRotateTable = { id: 't1', number: 5 } as any;
    component.cancelRotate();
    expect(tablesService.regenerateTableQr).not.toHaveBeenCalled();
    expect(component.confirmRotateTable).toBeNull();
  });

  it('does nothing until acknowledged', () => {
    component.confirmRotateTable = { id: 't1', number: 5 } as any;
    component.rotateAck = false;
    component.confirmRotate();
    expect(tablesService.regenerateTableQr).not.toHaveBeenCalled();
  });

  it('a double confirm issues EXACTLY ONE request', () => {
    const inFlight = new Subject<any>();
    tablesService.regenerateTableQr.and.returnValue(inFlight.asObservable());
    component.confirmRotateTable = { id: 't1', number: 5 } as any;
    component.rotateAck = true;

    component.confirmRotate();
    component.confirmRotate(); // second click while in flight

    expect(tablesService.regenerateTableQr).toHaveBeenCalledTimes(1);
    expect(component.rotatingTableId).toBe('t1'); // loading state present
    inFlight.complete();
  });

  it('a second table cannot be rotated through a stale dialog while one is in flight', () => {
    const inFlight = new Subject<any>();
    tablesService.regenerateTableQr.and.returnValue(inFlight.asObservable());
    component.confirmRotateTable = { id: 't1', number: 5 } as any;
    component.rotateAck = true;
    component.confirmRotate();

    component.openRotateConfirm({ id: 't2', number: 6 } as any); // blocked

    expect(component.confirmRotateTable).toEqual({ id: 't1', number: 5 } as any);
    inFlight.complete();
  });

  it('on success swaps in the server credential, shows one toast, sets the notice, resets ack, keeps preview', () => {
    tablesService.tables$.next([
      { id: 't1', number: 5, hasQR: true, qrCredential: 'NEW-CRED' } as any,
    ]);
    tablesService.regenerateTableQr.and.returnValue(
      of({ id: 't1', number: 5, qrVersion: 2, qrRegeneratedAt: new Date(), qrCredential: 'NEW-CRED' }),
    );
    component.confirmRotateTable = { id: 't1', number: 5, qrCredential: 'OLD' } as any;
    component.rotateAck = true;

    component.confirmRotate();

    expect(component.qrPreviewTable?.qrCredential).toBe('NEW-CRED'); // old credential gone
    expect(component.isQrModalOpen).toBeTrue();
    expect(component.recentlyRotatedId).toBe('t1');
    expect(component.confirmRotateTable).toBeNull();
    expect(component.rotateAck).toBeFalse();
    expect(component.rotatingTableId).toBeNull();
    expect(toast.success).toHaveBeenCalledOnceWith(
      'Old QR revoked. Download or print the replacement QR now.',
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on failure preserves the old QR, keeps the dialog open, surfaces the backend message, clears the lock', () => {
    tablesService.regenerateTableQr.and.returnValue(throwError(() => 'boom from server'));
    const target = { id: 't1', number: 5, qrCredential: 'OLD' } as any;
    component.confirmRotateTable = target;
    component.rotateAck = true;

    component.confirmRotate();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.clear).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('boom from server');
    expect(component.confirmRotateTable).toBe(target); // stays open to retry
    expect(component.rotatingTableId).toBeNull(); // lock cleared via finalize
  });

  it('uses the fixed "existing QR is still active" fallback when the error carries no message', () => {
    tablesService.regenerateTableQr.and.returnValue(throwError(() => ({})));
    component.confirmRotateTable = { id: 't1', number: 5 } as any;
    component.rotateAck = true;

    component.confirmRotate();

    expect(toast.error).toHaveBeenCalledWith(
      'Could not regenerate this QR code. The existing QR is still active.',
    );
  });

  it('can retry after a failure (lock cleared)', () => {
    tablesService.regenerateTableQr.and.returnValue(throwError(() => 'boom'));
    component.confirmRotateTable = { id: 't1', number: 5 } as any;
    component.rotateAck = true;
    component.confirmRotate();
    expect(component.rotatingTableId).toBeNull();

    tablesService.tables$.next([
      { id: 't1', number: 5, hasQR: true, qrCredential: 'NEW' } as any,
    ]);
    tablesService.regenerateTableQr.and.returnValue(
      of({ id: 't1', number: 5, qrVersion: 3, qrRegeneratedAt: new Date(), qrCredential: 'NEW' }),
    );
    component.confirmRotate(); // rotateAck is still true; dialog still open

    expect(component.qrPreviewTable?.qrCredential).toBe('NEW');
  });
});

/**
 * QR row fail-closed guards + activation-vs-rotation separation. Copy/download
 * refuse a table with no usable credential, and area/bulk/single "generate"
 * actions only ever ACTIVATE missing QRs — never rotate an active one.
 */
describe('TablesSetupViewComponent — QR fail-closed + activation vs rotation', () => {
  let component: TablesSetupViewComponent;
  let tablesService: any;
  let toast: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'activateQrForTables', 'regenerateTableQr', 'bulkUpdateTables',
      'getAreas', 'getTables',
    ]);
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    tablesService.activateQrForTables.and.returnValue(of([]));
    toast = jasmine.createSpyObj('ToastService', [
      'success', 'error', 'warning', 'info', 'clear',
    ]);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth);
  });

  it('blocks copy and errors when the table has no credential', async () => {
    await component.handleCopyLink(
      { id: 't1', number: 5, hasQR: true, qrCredential: '' } as any,
    );
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('blocks download (no QRCode generation) when the table has no credential', async () => {
    const toDataURL = spyOn(QRCode, 'toDataURL');
    await component.handleDownloadQR(
      { id: 't1', number: 5, hasQR: true, qrCredential: undefined } as any,
    );
    expect(toDataURL).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('area generation targets only tables WITHOUT a QR and never rotates', () => {
    component.tables = [
      { id: 't1', areaId: 'a1', hasQR: false, number: 1 },
      { id: 't2', areaId: 'a1', hasQR: true, number: 2 },
      { id: 't3', areaId: 'a1', hasQR: false, number: 3 },
    ] as any;
    tablesService.activateQrForTables.and.returnValue(
      of([{ id: 't1', ok: true }, { id: 't3', ok: true }]),
    );

    component.generateQRForArea({ id: 'a1', name: 'Main' } as any);

    expect(tablesService.activateQrForTables).toHaveBeenCalledOnceWith(['t1', 't3']);
    expect(tablesService.regenerateTableQr).not.toHaveBeenCalled();
    const msg = toast.success.calls.mostRecent().args[0];
    expect(msg).toContain('Generated QR for 2');
    expect(msg).toContain('1 already had one');
  });

  it('area generation makes NO request when every table already has a QR', () => {
    component.tables = [{ id: 't2', areaId: 'a1', hasQR: true, number: 2 }] as any;
    component.generateQRForArea({ id: 'a1', name: 'Main' } as any);
    expect(tablesService.activateQrForTables).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it('bulk generate targets only missing selected tables and reports partial failures', () => {
    component.tables = [
      { id: 't1', hasQR: false, number: 1 },
      { id: 't2', hasQR: true, number: 2 },
      { id: 't3', hasQR: false, number: 3 },
    ] as any;
    component.selectedTableIds = ['t1', 't2', 't3'];
    tablesService.activateQrForTables.and.returnValue(
      of([{ id: 't1', ok: true }, { id: 't3', ok: false }]),
    );

    component.handleBulkAction('generate-qr');

    expect(tablesService.activateQrForTables).toHaveBeenCalledOnceWith(['t1', 't3']);
    expect(tablesService.regenerateTableQr).not.toHaveBeenCalled();
    const msg = toast.error.calls.mostRecent().args[0]; // a failure → error toast
    expect(msg).toContain('Generated QR for 1');
    expect(msg).toContain('1 already had one');
    expect(msg).toContain('1 failed');
    expect(component.selectedTableIds).toEqual([]); // cleared after the outcome
  });

  it('single missing-table generate activates without any revocation claim', () => {
    component.tables = [{ id: 't1', hasQR: false, number: 9 }] as any;
    tablesService.activateQrForTables.and.returnValue(of([{ id: 't1', ok: true }]));

    component.generateSingleTableQr({ id: 't1', number: 9, hasQR: false } as any);

    expect(tablesService.activateQrForTables).toHaveBeenCalledOnceWith(['t1']);
    expect(tablesService.regenerateTableQr).not.toHaveBeenCalled();
    const msg = toast.success.calls.mostRecent().args[0];
    expect(msg).toContain('QR code generated for Table 9');
    expect(msg.toLowerCase()).not.toContain('revok');
  });
});
