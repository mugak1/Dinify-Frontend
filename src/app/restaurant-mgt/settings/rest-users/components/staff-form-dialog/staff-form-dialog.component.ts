import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CountryISO, NgxIntlTelephoneInputModule } from 'ngx-intl-telephone-input';

import { EmployeeListUser } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import {
  ASSIGNABLE_ROLES,
  isAssignableRole,
  legacyRoleLabel,
  roleLabel,
} from '../../staff-roles';

interface RoleOption {
  value: string;
  label: string;
}

/**
 * Add / assign / edit a staff member. Re-skin of the legacy
 * `CommonUsersComponent` add/edit modals — the two-step phone-lookup flow,
 * UG/KE dial codes, and the create/assign/edit API calls are preserved
 * verbatim; only the presentation and the role options changed (finance dropped).
 *
 * "Smart" dialog: it owns the lookup + create/assign/edit calls (the two-step
 * flow is dialog-internal state, so keeping the API here avoids round-tripping
 * the intermediate lookup result through the parent). On success it emits
 * `saved` and the parent reloads + toasts + closes; errors are surfaced here.
 */
@Component({
  selector: 'app-staff-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NgxIntlTelephoneInputModule,
    DialogComponent,
  ],
  templateUrl: './staff-form-dialog.component.html',
})
export class StaffFormDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() editing: EmployeeListUser | null = null;
  @Input() restaurant: any;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  // Two-step add state (preserved from the legacy common-users flow):
  // enter phone → lookUp() → `checked` reveals the rest of the form, with
  // `user_id` set when the phone already belongs to a Dinify account.
  user_id: any = null;
  checked = false;
  saving = false;
  submitted = false;

  RegisterForm: FormGroup = this.buildRegisterForm();
  EditForm: FormGroup = this.buildEditForm(null);

  // Phone / dial-code config — UG + KE preferred, Uganda default (preserved).
  CountryISO = CountryISO;
  preferredCountries: CountryISO[] = [CountryISO.Uganda, CountryISO.Kenya];

  readonly roleLabel = roleLabel;

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private toast: ToastService,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.reset();
    }
  }

  get isEditing(): boolean {
    return !!this.editing;
  }

  get title(): string {
    return this.isEditing
      ? `Edit ${this.editing?.name || 'staff member'}`
      : 'Add staff member';
  }

  get subtitle(): string {
    if (this.isEditing) return "Update this member's role and access.";
    if (!this.checked) return 'Look up a phone number to add a team member.';
    return this.user_id
      ? 'This person already has a Dinify account.'
      : 'Add the new team member’s details.';
  }

  /** Add-mode picker: only the four assignable roles (finance dropped). */
  get addRoleOptions(): RoleOption[] {
    return ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }));
  }

  /**
   * Edit-mode picker: the four assignable roles, plus the member's current role
   * as a "(legacy)" option when it is no longer assignable (e.g. finance), so
   * editing never blanks or silently changes it.
   */
  get editRoleOptions(): RoleOption[] {
    const opts = this.addRoleOptions;
    const current = this.editing?.roles?.[0];
    if (current && !isAssignableRole(current)) {
      return [{ value: current, label: legacyRoleLabel(current) }, ...opts];
    }
    return opts;
  }

  onInputChange($event: any): void {
    this.RegisterForm.get('phone')?.setValue($event);
    this.RegisterForm.get('phone_number')?.setValue(
      String($event.phoneNumber).replace('+', '').replace(/\s/g, ''),
    );
    this.RegisterForm.get('country')?.setValue(
      String($event.iso2Code).toUpperCase(),
    );
  }

  submit(): void {
    if (!this.checked) {
      this.lookUp();
      return;
    }
    this.submitted = true;
    if (!this.RegisterForm.get('roles')?.value) return;
    this.saving = true;

    if (this.user_id) {
      // Assign an existing Dinify user to this restaurant.
      this.api
        .postPatch(
          'restaurant-setup/employees/',
          {
            user: this.user_id,
            restaurant: this.restaurant,
            roles: [this.RegisterForm.get('roles')?.value],
          },
          'post',
        )
        .subscribe({ next: () => this.onApiSuccess(), error: () => this.onApiError() });
    } else {
      // Create a brand-new employee.
      const val = this.RegisterForm.value;
      val.roles = [this.RegisterForm.get('roles')?.value];
      val.restaurant = this.restaurant;
      this.api
        .postPatch(
          this.restaurant ? 'restaurant-setup/create-employee/' : 'users/auth/register/',
          val,
          'post',
        )
        .subscribe({ next: () => this.onApiSuccess(), error: () => this.onApiError() });
    }
  }

  saveEdit(): void {
    this.submitted = true;
    if (!this.EditForm.get('roles')?.value) return;
    this.saving = true;
    this.api
      .postPatch(
        'restaurant-setup/employees/',
        {
          id: this.EditForm.get('id')?.value,
          roles: [this.EditForm.get('roles')?.value],
          active: this.EditForm.get('active')?.value,
        },
        'put',
      )
      .subscribe({ next: () => this.onApiSuccess(), error: () => this.onApiError() });
  }

  onCancel(): void {
    if (this.saving) return;
    this.closed.emit();
  }

  private lookUp(): void {
    const contact = this.RegisterForm.get('phone_number')?.value;
    if (!contact) {
      this.submitted = true;
      return;
    }
    this.saving = true;
    this.api.get<any>(null, 'users/user-lookup/?contact=' + contact).subscribe({
      next: (x) => {
        this.saving = false;
        if (x.status === 200) {
          this.user_id = (x.data as any)?.id ?? null;
          this.submitted = false;
          this.checked = true;
        } else if (x.status === 400) {
          this.user_id = null;
          this.submitted = false;
          this.checked = true;
        } else {
          this.toast.clear();
          this.toast.error('Could not look up that number. Please try again.');
        }
      },
      error: () => {
        this.saving = false;
        this.toast.clear();
        this.toast.error('Could not look up that number. Please try again.');
      },
    });
  }

  private onApiSuccess(): void {
    this.saving = false;
    this.saved.emit();
  }

  private onApiError(): void {
    this.saving = false;
    this.toast.clear();
    this.toast.error('Something went wrong. Please try again.');
  }

  private reset(): void {
    this.user_id = null;
    this.checked = false;
    this.saving = false;
    this.submitted = false;
    this.RegisterForm = this.buildRegisterForm();
    this.EditForm = this.buildEditForm(this.editing);
  }

  private buildRegisterForm(): FormGroup {
    return this.fb.group({
      first_name: [''],
      last_name: [''],
      phone: [''],
      phone_number: [''],
      password: [''],
      country: ['UG'],
      email: [''],
      roles: [''],
      role: [''],
    });
  }

  private buildEditForm(user: EmployeeListUser | null): FormGroup {
    const role = user?.roles?.length ? user.roles[0] : '';
    return this.fb.group({
      name: [user?.name ?? ''],
      id: [user?.id ?? ''],
      restaurant: [this.restaurant],
      roles: [role],
      active: [user ? String(user.active) : 'true'],
    });
  }
}
