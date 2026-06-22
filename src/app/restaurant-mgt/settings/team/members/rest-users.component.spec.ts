import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { RestUsersComponent } from './rest-users.component';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
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
    user: {
      id: 'usr1',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: '',
      phone_number: '256700000000',
    },
    ...over,
  };
}

describe('RestUsersComponent', () => {
  let component: RestUsersComponent;
  let fixture: ComponentFixture<RestUsersComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  function configure(
    records: EmployeeListUser[],
    restaurantRole: { restaurant_id: string } | null,
  ) {
    api = jasmine.createSpyObj('ApiService', ['get', 'postPatch']);
    api.get.and.returnValue(of({ data: { records } } as any));
    api.postPatch.and.returnValue(of({} as any));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'clear']);

    TestBed.configureTestingModule({
      imports: [RestUsersComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthenticationService,
          useValue: { currentRestaurantRole: restaurantRole },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    fixture = TestBed.createComponent(RestUsersComponent);
    component = fixture.componentInstance;
    // Drive init manually (no detectChanges) to keep this a logic-only test and
    // avoid rendering the phone-input child in the headless test env.
    component.ngOnInit();
  }

  it('loads staff for the current restaurant on init', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    expect(api.get).toHaveBeenCalledWith(
      null,
      'restaurant-setup/employees/?restaurant=rest-1',
    );
    expect(component.users.length).toBe(1);
    expect(component.sectionState).toBe('ready');
  });

  it('reports the empty state when there are no staff', () => {
    configure([], { restaurant_id: 'rest-1' });
    expect(component.sectionState).toBe('empty');
  });

  it('reports the error state when no restaurant can be resolved', () => {
    configure([makeUser()], null);
    expect(api.get).not.toHaveBeenCalled();
    expect(component.sectionState).toBe('error');
  });

  it('filters staff by name', () => {
    configure(
      [makeUser({ id: 'a', name: 'Alice' }), makeUser({ id: 'b', name: 'Bob' })],
      { restaurant_id: 'rest-1' },
    );
    component.onSearch('ali');
    expect(component.users.map((u) => u.name)).toEqual(['Alice']);
    component.onSearch('');
    expect(component.users.length).toBe(2);
  });

  it('reloads and toasts after an edit save', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    api.get.calls.reset();
    component.editingStaff = makeUser();
    component.onSaved();
    expect(api.get).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Staff member updated');
    expect(component.formOpen).toBeFalse();
    expect(component.editingStaff).toBeNull();
  });

  it('toasts the add message after a create save', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    component.editingStaff = null;
    component.onSaved();
    expect(toast.success).toHaveBeenCalledWith('Staff member added');
  });

  it('opens the credential dialog with the temp password on create', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    component.onCreated({ data: { temp_password: 'TMP-9', name: 'New Hire' } } as any);
    expect(component.credentialOpen).toBeTrue();
    expect(component.credentialTempPassword).toBe('TMP-9');
    expect(component.credentialName).toBe('New Hire');
    expect(component.formOpen).toBeFalse();
  });

  it('reads the temp password defensively from the top level too', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    component.onCreated({ temp_password: 'TOP-LVL' } as any);
    expect(component.credentialOpen).toBeTrue();
    expect(component.credentialTempPassword).toBe('TOP-LVL');
  });

  it('falls back to the generic toast (no credential dialog) when create returns no temp password', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    component.onCreated({ data: {} } as any);
    expect(component.credentialOpen).toBeFalse();
    expect(toast.success).toHaveBeenCalledWith('Staff member added');
  });

  it('clears the credential dialog state on close', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    component.onCreated({ temp_password: 'TMP-9' } as any);
    component.onCredentialClosed();
    expect(component.credentialOpen).toBeFalse();
    expect(component.credentialTempPassword).toBe('');
    expect(component.credentialName).toBe('');
  });

  it('soft-deletes with the exact legacy call signature', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    component.openDelete(makeUser({ id: 'del-1' }));
    component.onRemoveConfirmed('left the team');
    expect(api.postPatch).toHaveBeenCalledWith(
      'restaurant-setup/employees/',
      { id: 'del-1', deletion_reason: 'left the team', active: 'false' },
      'put',
      '',
      {},
      false,
      '',
      true,
    );
    expect(toast.success).toHaveBeenCalledWith('Staff member removed');
    expect(component.removeOpen).toBeFalse();
  });

  it('surfaces a single toast on delete failure (clear then error)', () => {
    configure([makeUser()], { restaurant_id: 'rest-1' });
    api.postPatch.and.returnValue(throwError(() => new Error('boom')));
    component.openDelete(makeUser());
    component.onRemoveConfirmed('reason');
    expect(toast.clear).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(component.removing).toBeFalse();
  });

  it('labels a legacy finance role via titlecase fallback', () => {
    configure([makeUser({ roles: ['finance'] })], { restaurant_id: 'rest-1' });
    expect(component.roleLabel('finance')).toBe('Finance');
  });
});
