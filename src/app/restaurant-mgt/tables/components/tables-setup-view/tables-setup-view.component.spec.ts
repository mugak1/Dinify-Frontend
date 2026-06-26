import { BehaviorSubject, of, throwError } from 'rxjs';
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
