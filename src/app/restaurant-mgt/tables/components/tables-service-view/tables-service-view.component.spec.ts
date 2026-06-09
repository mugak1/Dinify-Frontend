import { of, throwError } from 'rxjs';
import { TablesServiceViewComponent } from './tables-service-view.component';

/**
 * Floor-plan save error handling. The save now goes through a single atomic
 * batch call; a failure must surface the message (clearing the global banner)
 * and re-sync from the server so the layout can't silently desync, and success
 * must only be reported once the save actually resolves.
 */
describe('TablesServiceViewComponent — floor plan save', () => {
  let component: TablesServiceViewComponent;
  let tablesService: any;
  let toast: any;
  let message: any;

  beforeEach(() => {
    tablesService = jasmine.createSpyObj('TablesService', [
      'updateFloorPlan', 'createTable', 'getTables',
    ]);
    tablesService.getTables.and.returnValue(of([]));
    tablesService.createTable.and.returnValue(of(null));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    message = jasmine.createSpyObj('MessageService', ['clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'r1' } } as any;
    const localStorage = { getItem: () => null, setItem: () => {} } as any;
    component = new TablesServiceViewComponent(
      tablesService, toast, message, auth, localStorage,
    );
  });

  const table = (id: string) =>
    ({ id, x: 12, y: 34, width: 5, height: 6 } as any);

  it('saves in one call with full geometry and toasts only on success', () => {
    tablesService.updateFloorPlan.and.returnValue(of({ data: { updated_count: 1 } }));

    component.onTablesChange([table('t1')]);

    expect(tablesService.updateFloorPlan).toHaveBeenCalledWith('r1', [
      { id: 't1', floor_x: 12, floor_y: 34, floor_width: 5, floor_height: 6 },
    ]);
    expect(toast.success).toHaveBeenCalledWith('Layout saved');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('surfaces the error, clears the banner and re-syncs on a failed save', () => {
    tablesService.updateFloorPlan.and.returnValue(throwError(() => 'Save failed'));

    component.onTablesChange([table('t1')]);

    expect(message.clear).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Save failed');
    expect(tablesService.getTables).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('falls back to a clear message when the error carries none', () => {
    tablesService.updateFloorPlan.and.returnValue(throwError(() => ({})));

    component.onTablesChange([table('t1')]);

    expect(toast.error).toHaveBeenCalledWith(
      'Could not save the floor plan. Please try again.',
    );
  });

  it('creates new tables individually and does not batch them', () => {
    component.onTablesChange([
      { id: 't-new-1', x: 1, y: 2, width: 5, height: 6 } as any,
    ]);

    expect(tablesService.createTable).toHaveBeenCalled();
    expect(tablesService.updateFloorPlan).not.toHaveBeenCalled();
  });
});
