import { Component } from '@angular/core';

import { RouterModule } from '@angular/router';

import {
  SettingsIconComponent,
  SettingsIconName,
} from '../components/settings-icon/settings-icon.component';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ModuleKey } from '../../../_models/app.models';
import { PageHeaderComponent } from '../../../_shared/ui/page-header/page-header.component';

interface HubItem {
  label: string;
  description: string;
  icon: SettingsIconName;
  route: string;
  // Optional RBAC gate. Module-less items are always shown; the route guard is
  // the real enforcement, so this is presentation-only (hides cards a user
  // can't open). Currently only Team and Billing are gated.
  module?: ModuleKey;
}

interface HubGroup {
  title: string;
  items: HubItem[];
}

/**
 * Settings hub landing — the default `settings` route. Grouped cards (Restaurant
 * / Your account), each routing to its section. Replaces the retired
 * horizontal-tab shell. Standalone, following the preset-tags pattern.
 */
@Component({
  selector: 'app-settings-hub',
  standalone: true,
  imports: [RouterModule, SettingsIconComponent, PageHeaderComponent],
  templateUrl: './settings-hub.component.html',
})
export class SettingsHubComponent {
  readonly groups: HubGroup[] = [
    {
      title: 'Restaurant',
      items: [
        {
          label: 'Restaurant identity & branding',
          description: "Your restaurant's name, logo, and brand colours.",
          icon: 'restaurant',
          route: '/settings/restaurant',
        },
        {
          label: 'Availability',
          description: 'Opening hours and when you accept orders.',
          icon: 'availability',
          route: '/settings/availability',
        },
        {
          label: 'Team',
          description: 'Invite team members and manage their access.',
          icon: 'staff',
          route: '/settings/team',
          module: 'team',
        },
        {
          label: 'Tax & receipts',
          description: 'Tax rates and what shows on customer receipts.',
          icon: 'tax',
          route: '/settings/tax-receipts',
        },
        {
          label: 'Billing',
          description: 'Your subscription, payment method, and invoices.',
          icon: 'billing',
          route: '/settings/billing',
          module: 'billing',
        },
        {
          label: 'Preset tags',
          description: 'Dietary and descriptor tags diners see on your menu.',
          icon: 'preset-tags',
          route: '/settings/preset-tags',
        },
      ],
    },
    {
      title: 'Your account',
      items: [
        {
          label: 'Account & security',
          description: 'Your login details and account security.',
          icon: 'account',
          route: '/settings/account',
        },
      ],
    },
  ];

  constructor(private auth: AuthenticationService) {}

  /** Groups with gated items the current membership can't access removed (and any group left empty dropped). */
  get visibleGroups(): HubGroup[] {
    return this.groups
      .map(g => ({ ...g, items: g.items.filter(i => !i.module || this.auth.canAccess(i.module)) }))
      .filter(g => g.items.length > 0);
  }
}
