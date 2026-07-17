import { Component, OnInit } from '@angular/core';


import { SwitchComponent, ToastService } from 'src/app/_shared/ui';
import { SectionPageComponent } from '../../components/section-page/section-page.component';
import { RolePermissionsService, RoleGridRow } from 'src/app/_services/role-permissions.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ModuleKey, PermissionsMap } from 'src/app/_models/app.models';
import { DISPLAYABLE_ROLES, roleLabel } from '../members/staff-roles';

type GridLoadState = 'loading' | 'ready' | 'error';

/**
 * Owner-only Roles & access grid (Settings → Team → Roles). Rows are the four
 * backend roles, columns the seven grid modules. Each cell toggles a role's
 * access to a module: optimistic switch → PUT → success toast, reverting on ANY
 * PUT failure with an error toast.
 *
 * Enforcement note: this is an AUTHORING surface, not the enforcement boundary.
 * The permissions map is a login-time snapshot, so an edit only re-shapes a
 * logged-in user of that role at their next sign-in — surfaced by the staleness
 * hint in the template. The owner row is locked from the response's `editable`
 * flag (never inferred from the role name), so the lock stays data-driven.
 */
@Component({
  selector: 'app-roles-access',
  standalone: true,
  imports: [SwitchComponent, SectionPageComponent],
  templateUrl: './roles-access.component.html',
})
export class RolesAccessComponent implements OnInit {
  /** Grid columns — the seven grid modules, in the agreed display order. */
  readonly columns: { key: ModuleKey; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'kitchen', label: 'Kitchen' },
    { key: 'tables', label: 'Tables' },
    { key: 'menu', label: 'Menu' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'reports', label: 'Reports' },
    { key: 'settings', label: 'Settings' },
  ];

  rows: RoleGridRow[] = [];
  loadState: GridLoadState = 'loading';

  /** Exposed to the template for row labels (kitchen → "Chef", etc.). */
  readonly roleLabel = roleLabel;

  private restaurantId = '';

  constructor(
    private svc: RolePermissionsService,
    private auth: AuthenticationService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.restaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    this.load();
  }

  load(): void {
    this.loadState = 'loading';
    this.svc.getGrid(this.restaurantId).subscribe({
      next: (rows) => {
        this.rows = this.orderRows(rows);
        this.loadState = 'ready';
      },
      error: () => {
        this.loadState = 'error';
      },
    });
  }

  isOn(row: RoleGridRow, key: ModuleKey): boolean {
    return row.modules[key] ?? false;
  }

  onToggle(row: RoleGridRow, key: ModuleKey, next: boolean): void {
    // Owner-row switches are disabled in the template; this is belt-and-suspenders.
    if (!row.editable) return;

    const prev = row.modules[key] ?? false;
    // Optimistic: reflect the new state immediately.
    row.modules = { ...row.modules, [key]: next };
    // PUT the role's FULL module map (preserving any non-grid keys it carries).
    const modules: PermissionsMap = { ...row.modules };

    this.svc.saveRole(this.restaurantId, row.role, modules).subscribe({
      next: () => this.toast.success('Permissions updated'),
      error: () => {
        // Revert on ANY failure mode (network error, 4xx/5xx, timeout) so the UI
        // never shows a state the backend didn't persist. Error toast, never success.
        row.modules = { ...row.modules, [key]: prev };
        this.toast.clear();
        this.toast.error('Could not update permissions. Please try again.');
      },
    });
  }

  /** Order rows by the canonical DISPLAYABLE_ROLES sequence (owner first). */
  private orderRows(rows: RoleGridRow[]): RoleGridRow[] {
    const order = DISPLAYABLE_ROLES as readonly string[];
    const rank = (role: string) => {
      const i = order.indexOf(role);
      return i === -1 ? order.length : i;
    };
    return [...rows].sort((a, b) => rank(a.role) - rank(b.role));
  }
}
