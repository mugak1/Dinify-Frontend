import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AccountSecurityComponent } from './account-security.component';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    first_name: 'Amara',
    last_name: 'Okello',
    email: 'amara@example.com',
    phone_number: '256700000000',
    roles: [],
    other_names: null,
    restaurant_roles: [],
    ...overrides,
  };
}

describe('AccountSecurityComponent', () => {
  let component: AccountSecurityComponent;
  let fixture: ComponentFixture<AccountSecurityComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let auth: { userValue: { profile: ReturnType<typeof makeProfile> }; updateProfile: jasmine.Spy };

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'postPatch',
      'UserChangePasswordOnLogin',
    ]);
    api.postPatch.and.returnValue(
      of({ data: { profile: makeProfile() }, message: 'Saved' }) as any,
    );
    api.UserChangePasswordOnLogin.and.returnValue(
      of({ body: { message: 'Password changed' } }) as any,
    );

    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'clear',
    ]);

    auth = {
      userValue: { profile: makeProfile() },
      updateProfile: jasmine.createSpy('updateProfile'),
    };

    await TestBed.configureTestingModule({
      imports: [AccountSecurityComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: AuthenticationService, useValue: auth },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountSecurityComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
  });

  it('creates and seeds the profile form from auth.userValue.profile', () => {
    expect(component).toBeTruthy();
    expect(component.profileForm.value).toEqual({
      first_name: 'Amara',
      last_name: 'Okello',
      email: 'amara@example.com',
    });
    expect(component.phoneOnFile).toBe('256700000000');
    expect(component.isDirty).toBeFalse();
  });

  it('saves profile edits via PUT users/user-profile/, syncs auth, and clears dirty', () => {
    component.profileForm.get('first_name')!.setValue('Amari');
    component.profileForm.get('first_name')!.markAsDirty();
    expect(component.isDirty).toBeTrue();

    component.onSave();

    expect(api.postPatch).toHaveBeenCalledTimes(1);
    const [url, payload, method] = api.postPatch.calls.mostRecent().args;
    expect(url).toBe('users/user-profile/');
    expect(method).toBe('put');
    expect(payload).toEqual({
      first_name: 'Amari',
      last_name: 'Okello',
      email: 'amara@example.com',
    });
    expect(auth.updateProfile).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(component.savingProfile).toBeFalse();
    expect(component.isDirty).toBeFalse();
  });

  it('does not let password edits trigger the profile save bar', () => {
    component.passwordForm.get('new_password')!.setValue('abc12!');
    component.passwordForm.get('new_password')!.markAsDirty();
    expect(component.passwordForm.dirty).toBeTrue();
    expect(component.isDirty).toBeFalse();
  });

  it('flags a password mismatch and clears it when the two match', () => {
    component.passwordForm.patchValue({
      new_password: 'abc12!',
      confirmPassword: 'zzz99!',
    });
    expect(component.passwordForm.errors?.['passwordMismatch']).toBeTruthy();

    component.passwordForm.patchValue({ confirmPassword: 'abc12!' });
    expect(component.passwordForm.errors?.['passwordMismatch']).toBeFalsy();
  });

  it('enforces min length + complexity on the new password', () => {
    const ctrl = component.passwordForm.get('new_password')!;
    ctrl.setValue('abc'); // too short, no digit/symbol
    expect(ctrl.invalid).toBeTrue();
    ctrl.setValue('abc12!'); // 6 chars, has digit + symbol
    expect(ctrl.valid).toBeTrue();
  });

  it('submits the password change with the expected payload and clears the form', () => {
    component.passwordForm.setValue({
      old_password: 'OldPass1!',
      new_password: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    });
    expect(component.passwordForm.valid).toBeTrue();

    component.onUpdatePassword();

    expect(api.UserChangePasswordOnLogin).toHaveBeenCalledTimes(1);
    const payload = api.UserChangePasswordOnLogin.calls.mostRecent().args[0];
    expect(payload).toEqual({
      username: 'amara@example.com',
      old_password: 'OldPass1!',
      new_password: 'NewPass1!',
      confirmPassword: 'NewPass1!',
    });
    expect(toast.success).toHaveBeenCalledWith('Password changed');
    expect(component.passwordForm.get('new_password')!.value).toBe('');
    expect(component.passwordForm.get('confirmPassword')!.value).toBe('');
    expect(component.changingPassword).toBeFalse();
  });

  it('does not call the API when the password form is invalid', () => {
    component.passwordForm.setValue({
      old_password: '',
      new_password: 'short',
      confirmPassword: 'short',
    });

    component.onUpdatePassword();

    expect(api.UserChangePasswordOnLogin).not.toHaveBeenCalled();
  });

  it('keeps savingProfile false and surfaces one toast on a profile save error', () => {
    api.postPatch.and.returnValue(throwError(() => new Error('boom')));
    component.profileForm.get('email')!.setValue('new@example.com');
    component.profileForm.get('email')!.markAsDirty();

    component.onSave();

    expect(component.savingProfile).toBeFalse();
    expect(toast.clear).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
