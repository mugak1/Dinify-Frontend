import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.component.html',
  styles: [`:host { display: contents; }`]
})
export class SidebarComponent {
  @Input() isOpen = false;
  @Output() sidebarToggle = new EventEmitter<void>();

  navItems: { label: string; route: string; icon: string }[] = [
    { label: 'Dashboard', route: '/rest-app/dashboard',     icon: 'dashboard' },
    { label: 'Menu',      route: '/rest-app/menu',          icon: 'menu' },
    { label: 'Tables',    route: '/rest-app/dining-tables', icon: 'tables' },
    { label: 'Reviews',   route: '/rest-app/reviews',       icon: 'reviews' },
    { label: 'Reports',   route: '/rest-app/reports',       icon: 'reports' },
    { label: 'Payments',  route: '/rest-app/payments',      icon: 'payments' },
    { label: 'Support',   route: '/rest-app/support',       icon: 'support' },
    { label: 'Settings',  route: '/rest-app/settings',      icon: 'settings' },
  ];
}
