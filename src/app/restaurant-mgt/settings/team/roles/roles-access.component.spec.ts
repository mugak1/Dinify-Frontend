import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { RolesAccessComponent } from './roles-access.component';
import { RolePermissionsService, RoleGridRow } from 'src/app/_services/role-permissions.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui';

describe('RolesAccessComponent', () => {
  let fixture: ComponentFixture<RolesAccessComponent>;
  let component: RolesAccessComponent;
  let svc: jasmine.SpyObj<RolePermissionsService>;
  let toast: jasmine.SpyObj<ToastService>;

  function setup(rows: RoleGridRow[]) {
    svc = jasmine.createSpyObj('RolePermissionsService', ['getGrid', 'saveRole']);
    svc.getGrid.and.returnValue(of(rows));
    svc.saveRole.and.returnValue(of({}));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);
    const auth = { currentRestaurantRole: { restaurant_id: 'rest-1' } };

    TestBed.configureTestingModule({
      imports: [RolesAccessComponent],
      providers: [
        provideRouter([]),
        { provide: RolePermissionsService, useValue: svc },
        { provide: AuthenticationService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });

    fixture = TestBed.createComponent(RolesAccessComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders the staleness hint near the grid', () => {
    setup([{ role: 'owner', editable: false, modules: {} }]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Changes apply when affected users next sign in.');
  });

  it('locks a row from the response `editable` flag, not the role name (data-driven)', () => {
    // Inverted from reality — owner editable, manager locked. If the lock were
    // hardcoded to role === "owner" this would fail.
    setup([
      { role: 'owner', editable: true, modules: { dashboard: true } },
      { role: 'manager', editable: false, modules: { dashboard: true } },
    ]);

    // Scope to the desktop table (switches live in <td>); the <md card list
    // mirrors the same controls and is asserted separately below.
    const buttons = fixture.debugElement
      .queryAll(By.css('table app-dn-switch button'))
      .map((d) => (d.nativeElement as HTMLButtonElement).disabled);

    const cols = component.columns.length; // 7
    const ownerDisabled = buttons.slice(0, cols);
    const managerDisabled = buttons.slice(cols, cols * 2);

    expect(buttons.length).toBe(cols * 2);
    expect(ownerDisabled.every((d) => d === false)).toBeTrue();   // editable owner → interactive
    expect(managerDisabled.every((d) => d === true)).toBeTrue();  // non-editable manager → locked
  });

  it('mirrors the lock state in the narrow-screen card list (mobile keeps editability)', () => {
    setup([
      { role: 'owner', editable: true, modules: { dashboard: true } },
      { role: 'manager', editable: false, modules: { dashboard: true } },
    ]);

    // The <md card list renders its switches inside <li>; the table uses <td>.
    const cardDisabled = fixture.debugElement
      .queryAll(By.css('li app-dn-switch button'))
      .map((d) => (d.nativeElement as HTMLButtonElement).disabled);

    const cols = component.columns.length; // 7
    // Same controls as the table — not dropped on mobile.
    expect(cardDisabled.length).toBe(cols * 2);
    expect(cardDisabled.slice(0, cols).every((d) => d === false)).toBeTrue();    // editable owner → interactive
    expect(cardDisabled.slice(cols, cols * 2).every((d) => d === true)).toBeTrue(); // locked manager → disabled
  });

  it('persists a manager toggle via saveRole with the role\'s full module map + success toast', () => {
    setup([{ role: 'manager', editable: true, modules: { dashboard: false, menu: true } }]);

    component.onToggle(component.rows[0], 'dashboard', true);

    expect(svc.saveRole).toHaveBeenCalledTimes(1);
    const [restaurant, role, modules] = svc.saveRole.calls.mostRecent().args as [string, string, any];
    expect(restaurant).toBe('rest-1');
    expect(role).toBe('manager');
    expect(modules.dashboard).toBeTrue();
    expect(modules.menu).toBeTrue(); // full map preserved, not just the toggled key
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reverts the cell and fires an ERROR toast (never success) when the PUT fails', () => {
    setup([{ role: 'manager', editable: true, modules: { dashboard: false } }]);
    svc.saveRole.and.returnValue(throwError(() => new Error('boom')));
    const row = component.rows[0];

    component.onToggle(row, 'dashboard', true);

    expect(row.modules.dashboard).toBeFalse(); // reverted to prior value
    expect(toast.clear).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('ignores toggles on a locked row (belt-and-suspenders)', () => {
    setup([{ role: 'owner', editable: false, modules: { dashboard: true } }]);
    component.onToggle(component.rows[0], 'dashboard', false);
    expect(svc.saveRole).not.toHaveBeenCalled();
  });
});
