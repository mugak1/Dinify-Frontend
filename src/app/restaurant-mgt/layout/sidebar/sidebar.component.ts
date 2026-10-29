import { ChangeDetectionStrategy, Component, ElementRef, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TooltipDirective } from '../../../_shared/ui/tooltip/tooltip.directive';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ModuleKey } from '../../../_models/app.models';
import { NO_MODULE_ROUTE } from '../../../_helpers/module-access';
import { EXPANDED_WIDTH_PX, RAIL_WIDTH_PX, ShellRegime } from '../shell-layout';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, TooltipDirective],
  templateUrl: './sidebar.component.html',
  styles: [`:host { display: contents; }`]
})
export class SidebarComponent {
  /** The shell's width regime (layout/shell-layout.ts). */
  @Input() regime: ShellRegime = 'rail-push';
  /** The labelled 220px panel is showing (open drawer, rail overlay, or expanded rail). */
  @Input() expanded = false;
  /** The width the sidebar takes in flow; the shell derives it from the regime. */
  @Input() inFlowWidth = RAIL_WIDTH_PX;
  @Output() sidebarToggle = new EventEmitter<void>();

  @ViewChild('toggle') private toggleButton?: ElementRef<HTMLButtonElement>;

  // `module` keys the item to an RBAC module; an undefined module (Support) is
  // always shown. Items the current membership can't access are filtered out by
  // visibleNavItems — UX hygiene mirroring the route guards.
  // `newTab` opens the item in a new browser tab instead of navigating the
  // portal away.
  navItems: { label: string; route: string; icon: string; module?: ModuleKey; newTab?: boolean }[] = [
    { label: 'Dashboard', route: '/dashboard',     icon: 'dashboard', module: 'dashboard' },
    { label: 'Menu',      route: '/menu',          icon: 'menu',      module: 'menu' },
    { label: 'Tables',    route: '/dining-tables', icon: 'tables',    module: 'tables' },
    // Kitchen (KDS board) is its own top-level route OUTSIDE the portal shell,
    // but it is a first-class RBAC module, so it gates through canAccess like its
    // siblings (owner/manager/kitchen see it; restaurant_staff has kitchen:false).
    // This is the sidebar entry the audit flagged as missing — /kitchen was
    // reachable only from a single dashboard anchor.
    // It opens in a NEW TAB: the board is a standalone display (no portal
    // shell) that a kitchen keeps open, so the portal tab stays where it was.
    { label: 'Kitchen',   route: '/kitchen',       icon: 'kitchen',   module: 'kitchen', newTab: true },
    { label: 'Reviews',   route: '/reviews',       icon: 'reviews',   module: 'reviews' },
    { label: 'Reports',   route: '/reports',       icon: 'reports',   module: 'reports' },
    { label: 'Support',   route: '/support',       icon: 'support' },
    { label: 'Settings',  route: '/settings',      icon: 'settings',  module: 'settings' },
  ];

  constructor(public auth: AuthenticationService) {}

  /** A closed drawer: off-screen, and [inert] so it leaves the tab order. */
  get closedDrawer(): boolean {
    return this.regime === 'drawer' && !this.expanded;
  }

  /** The drawer is always the full sidebar; the rail is 64px until expanded. */
  get panelWidth(): number {
    return this.regime === 'drawer' || this.expanded ? EXPANDED_WIDTH_PX : RAIL_WIDTH_PX;
  }

  /** Return focus to the rail toggle (Esc closing the 1024–1279 overlay). */
  focusToggle(): void {
    this.toggleButton?.nativeElement.focus();
  }

  /** Nav items the current membership may access (always keeps module-less items). */
  get visibleNavItems() {
    return this.navItems.filter(i => !i.module || this.auth.canAccess(i.module));
  }

  /**
   * A user whose permissions grant no module at all. Derived from the SAME
   * predicate as the post-login landing (firstAccessibleRoute === the account
   * fallback), so the "No modules assigned" note and the /account landing
   * cannot diverge.
   */
  get noModuleUser(): boolean {
    return this.auth.firstAccessibleRoute() === NO_MODULE_ROUTE;
  }
}
