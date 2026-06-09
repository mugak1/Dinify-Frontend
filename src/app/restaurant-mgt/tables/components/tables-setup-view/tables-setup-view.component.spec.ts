import { of, throwError } from 'rxjs';
import { TablesSetupViewComponent } from './tables-setup-view.component';

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
