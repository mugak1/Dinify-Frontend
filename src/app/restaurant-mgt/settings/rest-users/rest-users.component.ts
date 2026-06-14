import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { EmployeeListUser } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';

import {
  SectionPageComponent,
  SectionPageState,
} from '../components/section-page/section-page.component';
import { StaffFormDialogComponent } from './components/staff-form-dialog/staff-form-dialog.component';
import { StaffRemoveDialogComponent } from './components/staff-remove-dialog/staff-remove-dialog.component';
import { StaffDetailDialogComponent } from './components/staff-detail-dialog/staff-detail-dialog.component';
import { roleLabel } from './staff-roles';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Staff & roles settings section. Standalone section parent mirroring the
 * preset-tags CRUD-with-dialogs model (no save bar): the section-page shell
 * wraps a staff list with View / Edit / Remove row actions and an "Add staff"
 * action. The add/assign/edit/remove + phone-lookup logic lives in the child
 * dialogs / preserved API calls — this PR re-skins and relocates that flow off
 * the legacy `_common/common-users` component and drops the finance role.
 */
@Component({
  selector: 'app-rest-users',
  standalone: true,
  imports: [
    CommonModule,
    SectionPageComponent,
    ButtonComponent,
    StaffFormDialogComponent,
    StaffRemoveDialogComponent,
    StaffDetailDialogComponent,
  ],
  templateUrl: './rest-users.component.html',
})
export class RestUsersComponent implements OnInit {
  restaurant: any;
  users: EmployeeListUser[] = [];
  private cache: EmployeeListUser[] = [];
  search = '';
  loadState: LoadState = 'loading';

  formOpen = false;
  editingStaff: EmployeeListUser | null = null;

  detailOpen = false;
  detailStaff: EmployeeListUser | null = null;

  removeOpen = false;
  removeStaff: EmployeeListUser | null = null;
  removing = false;

  readonly roleLabel = roleLabel;

  constructor(
    private auth: AuthenticationService,
    private api: ApiService,
    private route: ActivatedRoute,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    if (this.auth.currentRestaurantRole?.restaurant_id) {
      this.restaurant = this.auth.currentRestaurantRole.restaurant_id;
    } else if (this.route.parent?.parent?.snapshot.params['id']) {
      this.restaurant = this.route.parent?.parent?.snapshot.params['id'];
    }

    if (this.restaurant) {
      this.getUsers(this.restaurant);
    } else {
      this.loadState = 'error';
    }
  }

  // ── Loading / search ──────────────────────────────────────────────────

  getUsers(id: any): void {
    this.loadState = 'loading';
    this.api.get<EmployeeListUser>(null, 'restaurant-setup/employees/?restaurant=' + id).subscribe({
      next: (x) => {
        this.cache = x.data?.records ?? [];
        this.applySearch();
        this.loadState = 'ready';
      },
      error: () => {
        this.loadState = 'error';
      },
    });
  }

  retry(): void {
    if (this.restaurant) this.getUsers(this.restaurant);
  }

  onSearch(term: string): void {
    this.search = term;
    this.applySearch();
  }

  private applySearch(): void {
    const term = this.search.trim().toLowerCase();
    this.users = term
      ? this.cache.filter((u) => (u.name ?? '').toLowerCase().includes(term))
      : [...this.cache];
  }

  get sectionState(): SectionPageState {
    if (this.loadState === 'loading') return 'loading';
    if (this.loadState === 'error') return 'error';
    if (this.cache.length === 0) return 'empty';
    return 'ready';
  }

  // ── Add / edit ────────────────────────────────────────────────────────

  openAdd(): void {
    this.editingStaff = null;
    this.formOpen = true;
  }

  openEdit(user: EmployeeListUser): void {
    this.editingStaff = user;
    this.formOpen = true;
  }

  onFormClosed(): void {
    this.formOpen = false;
    this.editingStaff = null;
  }

  onSaved(): void {
    const wasEditing = !!this.editingStaff;
    this.onFormClosed();
    this.getUsers(this.restaurant);
    this.toast.success(wasEditing ? 'Staff member updated' : 'Staff member added');
  }

  // ── View ──────────────────────────────────────────────────────────────

  openView(user: EmployeeListUser): void {
    this.detailStaff = user;
    this.detailOpen = true;
  }

  onDetailClosed(): void {
    this.detailOpen = false;
    this.detailStaff = null;
  }

  // ── Remove (soft delete) ──────────────────────────────────────────────

  openDelete(user: EmployeeListUser): void {
    this.removeStaff = user;
    this.removeOpen = true;
  }

  onRemoveCancelled(): void {
    this.removeOpen = false;
    this.removeStaff = null;
  }

  onRemoveConfirmed(reason: string): void {
    const staff = this.removeStaff;
    if (!staff) return;
    this.removing = true;
    // Preserve the legacy soft-delete call signature exactly (trailing flag).
    this.api
      .postPatch(
        'restaurant-setup/employees/',
        { id: staff.id, deletion_reason: reason, active: 'false' },
        'put',
        '',
        {},
        false,
        '',
        true,
      )
      .subscribe({
        next: () => {
          this.removing = false;
          this.removeOpen = false;
          this.removeStaff = null;
          this.getUsers(this.restaurant);
          this.toast.success('Staff member removed');
        },
        error: () => {
          this.removing = false;
          this.toast.clear();
          this.toast.error('Could not remove staff member.');
        },
      });
  }

  trackById(_index: number, user: EmployeeListUser): string {
    return user.id;
  }
}
