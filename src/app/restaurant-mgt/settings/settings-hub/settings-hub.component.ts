import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import {
  SettingsIconComponent,
  SettingsIconName,
} from '../components/settings-icon/settings-icon.component';

interface HubItem {
  label: string;
  description: string;
  icon: SettingsIconName;
  route: string;
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
  imports: [CommonModule, RouterModule, SettingsIconComponent],
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
          route: '/rest-app/settings/restaurant',
        },
        {
          label: 'Availability',
          description: 'Opening hours and when you accept orders.',
          icon: 'availability',
          route: '/rest-app/settings/availability',
        },
        {
          label: 'Team',
          description: 'Invite team members and manage their access.',
          icon: 'staff',
          route: '/rest-app/settings/team',
        },
        {
          label: 'Tax & receipts',
          description: 'Tax rates and what shows on customer receipts.',
          icon: 'tax',
          route: '/rest-app/settings/tax-receipts',
        },
        {
          label: 'Billing',
          description: 'Your subscription, payment method, and invoices.',
          icon: 'billing',
          route: '/rest-app/settings/billing',
        },
        {
          label: 'Preset tags',
          description: 'Dietary and descriptor tags diners see on your menu.',
          icon: 'preset-tags',
          route: '/rest-app/settings/preset-tags',
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
          route: '/rest-app/settings/account',
        },
      ],
    },
  ];
}
