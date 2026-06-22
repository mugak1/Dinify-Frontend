import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { StaffFormDialogComponent } from './staff-form-dialog.component';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { EmployeeListUser } from 'src/app/_models/app.models';

function makeUser(over: Partial<EmployeeListUser> = {}): EmployeeListUser {
  return {
    id: 'u1',
    time_created: '',
    time_last_updated: '',
    name: 'Jane Doe',
    roles: ['manager'],
    active: true,
    ...over,
  };
}

describe('StaffFormDialogComponent', () => {
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  function build(): StaffFormDialogComponent {
    api = jasmine.createSpyObj('ApiService', ['get', 'postPatch']);
    api.postPatch.and.returnValue(of({} as any));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);

    TestBed.configureTestingModule({
      imports: [StaffFormDialogComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    // No detectChanges: keep this a logic test and avoid rendering the phone
    // input. Inputs + ngOnChanges drive the component's state directly.
    const fixture = TestBed.createComponent(StaffFormDialogComponent);
    return fixture.componentInstance;
  }

  function open(c: StaffFormDialogComponent, editing: EmployeeListUser | null) {
    c.restaurant = 'rest-1';
    c.editing = editing;
    c.open = true;
    c.ngOnChanges({ open: { currentValue: true } as any });
  }

  it('offers only the assignable roles when adding (no owner/waiter/finance)', () => {
    const c = build();
    open(c, null);
    expect(c.addRoleOptions.map((o) => o.value)).toEqual([
      'manager',
      'kitchen',
      'restaurant_staff',
    ]);
  });

  it('keeps a legacy finance role selectable as "(legacy)" when editing', () => {
    const c = build();
    open(c, makeUser({ roles: ['finance'] }));
    const opts = c.editRoleOptions;
    expect(opts[0]).toEqual({ value: 'finance', label: 'Finance (legacy)' });
    expect(opts.length).toBe(4);
    expect(c.EditForm.get('roles')?.value).toBe('finance');
  });

  it('shows the current owner as plain "Owner" (not legacy) when editing', () => {
    const c = build();
    open(c, makeUser({ roles: ['owner'] }));
    const opts = c.editRoleOptions;
    expect(opts[0]).toEqual({ value: 'owner', label: 'Owner' });
    expect(opts.length).toBe(4);
    expect(opts.some((o) => o.label.includes('legacy'))).toBeFalse();
  });

  it('does not add a legacy option when editing a standard role', () => {
    const c = build();
    open(c, makeUser({ roles: ['manager'] }));
    expect(c.editRoleOptions.length).toBe(3);
    expect(c.editRoleOptions.some((o) => o.label.includes('legacy'))).toBeFalse();
  });

  it('parses the phone event into phone_number + country', () => {
    const c = build();
    open(c, null);
    c.onInputChange({ phoneNumber: '+256 700 111 222', iso2Code: 'ug' });
    expect(c.RegisterForm.get('phone_number')?.value).toBe('256700111222');
    expect(c.RegisterForm.get('country')?.value).toBe('UG');
  });

  it('looks up an existing user (status 200) and reveals role-only step', () => {
    const c = build();
    api.get.and.returnValue(of({ status: 200, data: { id: 'existing-user' } } as any));
    open(c, null);
    c.RegisterForm.get('phone_number')?.setValue('256700111222');
    c.submit(); // checked === false → lookUp
    expect(api.get).toHaveBeenCalledWith(
      null,
      'users/user-lookup/?contact=256700111222',
    );
    expect(c.checked).toBeTrue();
    expect(c.user_id).toBe('existing-user');
  });

  it('looks up an unknown number (status 400) and reveals the new-user step', () => {
    const c = build();
    api.get.and.returnValue(of({ status: 400 } as any));
    open(c, null);
    c.RegisterForm.get('phone_number')?.setValue('256700111222');
    c.submit();
    expect(c.checked).toBeTrue();
    expect(c.user_id).toBeNull();
  });

  it('assigns an existing user with the employees POST payload and emits saved (not created)', () => {
    const c = build();
    let saved = false;
    let created = false;
    c.saved.subscribe(() => (saved = true));
    c.created.subscribe(() => (created = true));
    api.get.and.returnValue(of({ status: 200, data: { id: 'existing-user' } } as any));
    open(c, null);
    c.RegisterForm.get('phone_number')?.setValue('256700111222');
    c.submit(); // lookup → existing
    c.RegisterForm.get('roles')?.setValue('restaurant_staff');
    c.submit(); // assign
    expect(api.postPatch).toHaveBeenCalledWith(
      'restaurant-setup/employees/',
      { user: 'existing-user', restaurant: 'rest-1', roles: ['restaurant_staff'] },
      'post',
    );
    expect(saved).toBeTrue();
    expect(created).toBeFalse(); // assign-existing must NOT open the credential dialog
  });

  it('creates a brand-new employee, emits created with the temp password (not saved)', () => {
    const c = build();
    api.postPatch.and.returnValue(of({ data: { temp_password: 'TMP-123' } } as any));
    let createdResp: any = null;
    let saved = false;
    c.created.subscribe((r) => (createdResp = r));
    c.saved.subscribe(() => (saved = true));
    api.get.and.returnValue(of({ status: 400 } as any));
    open(c, null);
    c.RegisterForm.get('phone_number')?.setValue('256700111222');
    c.submit(); // lookup → not found
    c.RegisterForm.get('first_name')?.setValue('New');
    c.RegisterForm.get('last_name')?.setValue('Hire');
    c.RegisterForm.get('roles')?.setValue('kitchen');
    c.submit(); // create
    const [url, payload, method] = api.postPatch.calls.mostRecent().args;
    expect(url).toBe('restaurant-setup/create-employee/');
    expect(method).toBe('post');
    expect(payload).toEqual(
      jasmine.objectContaining({
        first_name: 'New',
        last_name: 'Hire',
        roles: ['kitchen'],
        restaurant: 'rest-1',
      }),
    );
    expect(createdResp?.data?.temp_password).toBe('TMP-123');
    expect(saved).toBeFalse(); // create emits `created`, never `saved`
  });

  it('saves an edit with the employees PUT payload', () => {
    const c = build();
    open(c, makeUser({ id: 'emp-9', roles: ['manager'], active: true }));
    c.EditForm.get('roles')?.setValue('kitchen');
    c.EditForm.get('active')?.setValue('false');
    c.saveEdit();
    expect(api.postPatch).toHaveBeenCalledWith(
      'restaurant-setup/employees/',
      { id: 'emp-9', roles: ['kitchen'], active: 'false' },
      'put',
    );
  });

  it('blocks save until a role is chosen', () => {
    const c = build();
    api.get.and.returnValue(of({ status: 400 } as any));
    open(c, null);
    c.RegisterForm.get('phone_number')?.setValue('256700111222');
    c.submit(); // lookup
    c.submit(); // attempt save with no role
    expect(api.postPatch).not.toHaveBeenCalled();
    expect(c.submitted).toBeTrue();
  });
});
