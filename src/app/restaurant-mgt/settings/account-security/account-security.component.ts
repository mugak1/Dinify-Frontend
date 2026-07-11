import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HasUnsavedChanges } from '../../../_helpers/unsaved-changes.guard';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';

import { SectionPageComponent } from '../components/section-page/section-page.component';

interface ProfileSnapshot {
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Form-level validator: new_password must equal confirmPassword. Declared at
 * module scope (not a method) so it can be passed to FormBuilder.group without
 * an unbound-method reference — it never uses `this`. Mirrors the lock-screen
 * validator; the error key is `passwordMismatch`.
 */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const newPassword = group.get('new_password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return newPassword === confirmPassword ? null : { passwordMismatch: true };
}

/**
 * Account & security — the logged-in operator's own profile and password. Two
 * independent forms live inside the shared section-page scaffold:
 *
 *  - `profileForm` (name + email) drives the scaffold's sticky save bar via the
 *    `isDirty` getter, which reads ONLY profileForm so password edits never
 *    trip the bar. Saves through `PUT users/user-profile/`.
 *  - `passwordForm` is self-contained with its own "Update password" button — a
 *    discrete submit-and-clear action, separate from the profile dirty state.
 *    Posts to `users/auth/change-password/`.
 *
 * Profile is read synchronously from `auth.userValue.profile` (there is no
 * profile GET endpoint), so the scaffold stays in the 'ready' state — no
 * loading/error skeletons. Phone is shown read-only: changing it server-side
 * requires an OTP round-trip that does not fit the clean edit→Save contract.
 */
@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SectionPageComponent,
    ButtonComponent,
  ],
  templateUrl: './account-security.component.html',
})
export class AccountSecurityComponent implements OnInit, HasUnsavedChanges {
  profileForm: FormGroup;
  passwordForm: FormGroup;

  /** Profile save-in-flight — drives the scaffold's `[saving]`. */
  savingProfile = false;
  /** Password change in-flight — disables the password button. */
  changingPassword = false;

  // Independent show/hide toggles for the three password fields.
  showOld = false;
  showNew = false;
  showConfirm = false;

  /** Last-loaded profile values — the baseline `onDiscard()` resets to. */
  private loadedProfile: ProfileSnapshot = {
    first_name: '',
    last_name: '',
    email: '',
  };

  constructor(
    private fb: FormBuilder,
    private auth: AuthenticationService,
    private api: ApiService,
    private toast: ToastService,
  ) {
    this.profileForm = this.fb.group({
      first_name: ['', Validators.required],
      last_name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
    });

    this.passwordForm = this.fb.group(
      {
        old_password: ['', Validators.required],
        new_password: [
          '',
          [
            Validators.required,
            Validators.pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*])/),
            Validators.minLength(6),
          ],
        ],
        confirmPassword: ['', Validators.required],
      },
      { validators: passwordsMatch },
    );
  }

  ngOnInit(): void {
    this.populateProfile();
  }

  // ── Read-only account context ──────────────────────────────────────────────

  /** Phone on file (read-only). Empty string when the profile has none. */
  get phoneOnFile(): string {
    const raw = this.auth.userValue?.profile?.phone_number;
    return raw ? String(raw) : '';
  }

  // ── Profile (save-bar driven) ──────────────────────────────────────────────

  /**
   * Drives the scaffold's save bar. Reads ONLY `profileForm` so editing the
   * password fields never opens the bar.
   */
  get isDirty(): boolean {
    return this.profileForm.dirty;
  }

  private populateProfile(): void {
    const p = this.auth.userValue?.profile;
    this.loadedProfile = {
      first_name: p?.first_name ?? '',
      last_name: p?.last_name ?? '',
      email: p?.email ?? '',
    };
    this.profileForm.reset(this.loadedProfile);
    this.profileForm.markAsPristine();
  }

  onSave(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      this.toast.error('Please fix the highlighted fields.');
      return;
    }

    this.savingProfile = true;
    const v = this.profileForm.value;
    const payload = {
      first_name: (v.first_name ?? '').trim(),
      last_name: (v.last_name ?? '').trim(),
      email: (v.email ?? '').trim(),
    };

    this.api.postPatch('users/user-profile/', payload, 'put').subscribe({
      next: (res: any) => {
        this.savingProfile = false;
        const profile = res?.data?.profile;
        if (profile) this.auth.updateProfile(profile);
        // Re-seed from the now-current profile; clears the dirty/pristine state.
        this.populateProfile();
        this.toast.clear();
        this.toast.success(res?.message || 'Changes saved');
      },
      error: () => {
        this.savingProfile = false;
        // The HTTP ErrorInterceptor already queued a global banner; clear it so
        // the user sees one clean message, not two (matches Identity/Support).
        this.toast.clear();
        this.toast.error('Could not save your changes. Please try again.');
      },
    });
  }

  onDiscard(): void {
    this.profileForm.reset(this.loadedProfile);
    this.profileForm.markAsPristine();
  }

  /**
   * `state` is always 'ready' (profile reads from localStorage, no GET), so the
   * scaffold never renders its error state and this output can't fire in
   * practice; re-seed defensively to satisfy the contract.
   */
  retry(): void {
    this.populateProfile();
  }

  // ── Password (standalone submit-and-clear) ─────────────────────────────────

  onUpdatePassword(): void {
    if (this.passwordForm.invalid || this.changingPassword) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.changingPassword = true;
    const v = this.passwordForm.value;
    const payload = {
      // Belt-and-suspenders: the backend identifies the user from the JWT, but
      // the existing change-password flow always sends `username`.
      username: this.auth.userValue?.profile?.email ?? '',
      old_password: v.old_password,
      new_password: v.new_password,
      confirmPassword: v.confirmPassword,
    };

    // No authToken arg — the AuthInterceptor attaches the Bearer token for the
    // logged-in user.
    this.api.UserChangePasswordOnLogin(payload).subscribe({
      next: (res: any) => {
        this.changingPassword = false;
        this.toast.clear();
        this.toast.success(
          res?.body?.message || 'Password changed successfully',
        );
        this.passwordForm.reset({
          old_password: '',
          new_password: '',
          confirmPassword: '',
        });
        this.passwordForm.markAsPristine();
      },
      error: () => {
        // ErrorInterceptor already banners the failure; just stop the spinner.
        this.changingPassword = false;
      },
    });
  }

  // ── Field styling / validation helpers ─────────────────────────────────────

  /**
   * Shared input styling; swaps to a red ring when invalid. Copied from
   * IdentityComponent to match the other settings sections, with an optional
   * `trailingIcon` mode that reserves right padding for the password toggle.
   */
  fieldClass(invalid = false, trailingIcon = false): string {
    const padding = trailingIcon ? 'pl-3 pr-10' : 'px-3';
    return (
      `block w-full rounded-md border ${padding} py-2 text-sm text-gray-900 ` +
      'placeholder:text-gray-400 focus:outline-none focus:ring-1 ' +
      (invalid
        ? 'border-red-400 focus:border-red-400 focus:ring-red-400'
        : 'border-gray-300 focus:border-primary focus:ring-primary')
    );
  }

  private controlInvalid(form: FormGroup, name: string): boolean {
    const c = form.get(name);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  get firstNameInvalid(): boolean {
    return this.controlInvalid(this.profileForm, 'first_name');
  }
  get lastNameInvalid(): boolean {
    return this.controlInvalid(this.profileForm, 'last_name');
  }
  get emailInvalid(): boolean {
    return this.controlInvalid(this.profileForm, 'email');
  }
  get oldPwInvalid(): boolean {
    return this.controlInvalid(this.passwordForm, 'old_password');
  }
  get newPwInvalid(): boolean {
    return this.controlInvalid(this.passwordForm, 'new_password');
  }

  /** New-password `required` error (vs the complexity rule) for tailored copy. */
  get newPwRequired(): boolean {
    return !!this.passwordForm.get('new_password')?.errors?.['required'];
  }

  /** Mismatch shown only once the confirm field has been engaged. */
  get mismatch(): boolean {
    const c = this.passwordForm.get('confirmPassword');
    return (
      !!this.passwordForm.errors?.['passwordMismatch'] &&
      !!c &&
      (c.dirty || c.touched)
    );
  }
}
