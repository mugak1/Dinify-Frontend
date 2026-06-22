import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthenticationService } from '../../_services/authentication.service';
import { CardComponent, ButtonComponent, AvatarComponent } from '../../_shared/ui';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, CardComponent, ButtonComponent, AvatarComponent],
  templateUrl: './account.component.html',
})
export class AccountComponent {
  constructor(public auth: AuthenticationService) {}

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
    const roles = this.auth.currentRestaurantRole?.roles ?? [];
    return roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(', ');
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

  signOut(): void {
    this.auth.logout();
  }
}
