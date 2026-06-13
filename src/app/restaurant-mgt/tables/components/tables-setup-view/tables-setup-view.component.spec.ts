import { of, throwError } from 'rxjs';
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
  let message: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'deleteArea', 'deleteTable', 'getAreas', 'getTables',
    ]);
    // refresh() chains getAreas -> getTables on success; keep them inert.
    tablesService.getAreas.and.returnValue(of([]));
    tablesService.getTables.and.returnValue(of([]));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    message = jasmine.createSpyObj('MessageService', ['clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth, message);
  });

  // ── area delete ───────────────────────────────────────────────────────
  it('surfaces the backend block message when an area delete is rejected', () => {
    const blockMsg = 'Move or remove the 3 table(s) in this area before deleting it.';
    tablesService.deleteArea.and.returnValue(throwError(() => blockMsg));
    component.deleteAreaTarget = { id: 'a1' } as any;

    component.confirmDeleteArea();

    expect(toast.error).toHaveBeenCalledWith(blockMsg);
    expect(toast.success).not.toHaveBeenCalled();
    expect(message.clear).toHaveBeenCalled(); // global banner suppressed
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
    expect(message.clear).toHaveBeenCalled();
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
  let message: any;

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
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    message = jasmine.createSpyObj('MessageService', ['clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    component = new TablesSetupViewComponent(tablesService, toast, auth, message);
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

    expect(message.clear).toHaveBeenCalled();
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
