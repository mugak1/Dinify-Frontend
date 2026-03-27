import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

export interface NavItem {
  label: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule],
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  @Input() isOpen = false;
  @Output() sidebarToggle = new EventEmitter<void>();

  collapsed = false;

  navItems: NavItem[] = [
    { label: 'Dashboard', route: '/rest-app/dashboard', icon: 'layout-dashboard' },
    { label: 'Menu', route: '/rest-app/menu', icon: 'utensils-crossed' },
    { label: 'Orders', route: '/rest-app/orders', icon: 'clipboard-list' },
    { label: 'Tables', route: '/rest-app/dining-tables', icon: 'grid-3x3' },
    { label: 'Reviews', route: '/rest-app/reviews', icon: 'star' },
    { label: 'Reports', route: '/rest-app/reports', icon: 'chart-bar' },
    { label: 'Payments', route: '/rest-app/payments', icon: 'credit-card' },
    { label: 'Support', route: '/rest-app/support', icon: 'life-buoy' },
    { label: 'Settings', route: '/rest-app/settings', icon: 'settings' },
  ];

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
  }
}
