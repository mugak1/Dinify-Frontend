import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AuthenticationService } from '../../_services/authentication.service';
import { SessionActionsService } from '../layout/session-actions.service';
import { roleLabel } from '../settings/team/members/staff-roles';
import { CardComponent, ButtonComponent, AvatarComponent } from '../../_shared/ui';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-account',
  standalone: true,
  imports: [CardComponent, ButtonComponent, AvatarComponent],
  templateUrl: './account.component.html',
})
export class AccountComponent {
  constructor(
    public auth: AuthenticationService,
    private sessionActions: SessionActionsService,
  ) {}

  get name(): string {
    const p = this.auth.userValue?.profile;
    if (!p) return '';
    return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  }

  get email(): string {
    return this.auth.userValue?.profile?.email ?? '';
  }

  get phone(): string {
    const raw = this.auth.userValue?.profile?.phone_number;
    return raw ? String(raw) : '';
  }

  get roleLabel(): string {
    // The one role vocabulary (kitchen → "Chef", restaurant_staff → "Staff").
    const roles = this.auth.currentRestaurantRole?.roles ?? [];
    return roles.map((r) => roleLabel(r)).join(', ');
  }

  get restaurantName(): string {
    return (
      this.auth.currentRestaurant?.name ??
      this.auth.currentRestaurantRole?.restaurant ??
      ''
    );
  }

  /** The five read-only fields, in display order. */
  get fields(): { label: string; value: string }[] {
    return [
      { label: 'Name', value: this.name },
      { label: 'Email', value: this.email },
      { label: 'Phone', value: this.phone },
      { label: 'Role', value: this.roleLabel },
      { label: 'Restaurant', value: this.restaurantName },
    ];
  }

  /** The one sign-out path, shared with the top bar's avatar menu: one confirmation. */
  signOut(): void {
    this.sessionActions.confirmSignOut();
  }
}
