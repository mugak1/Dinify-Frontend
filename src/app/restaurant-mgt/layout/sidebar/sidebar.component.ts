import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges, Inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TooltipDirective } from '../../../_shared/ui/tooltip/tooltip.directive';
import { AvatarComponent } from '../../../_shared/ui';
import { AuthenticationService } from '../../../_services/authentication.service';
import { ModuleKey } from '../../../_models/app.models';
import { NO_MODULE_ROUTE } from '../../../_helpers/module-access';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, TooltipDirective, AvatarComponent],
  templateUrl: './sidebar.component.html',
  styles: [`:host { display: contents; }`]
})
export class SidebarComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Output() sidebarToggle = new EventEmitter<void>();

  // `module` keys the item to an RBAC module; an undefined module (Support) is
  // always shown. Items the current membership can't access are filtered out by
  // visibleNavItems — UX hygiene mirroring the route guards.
  navItems: { label: string; route: string; icon: string; module?: ModuleKey }[] = [
    { label: 'Dashboard', route: '/rest-app/dashboard',     icon: 'dashboard', module: 'dashboard' },
    { label: 'Menu',      route: '/rest-app/menu',          icon: 'menu',      module: 'menu' },
    { label: 'Tables',    route: '/rest-app/dining-tables', icon: 'tables',    module: 'tables' },
    { label: 'Reviews',   route: '/rest-app/reviews',       icon: 'reviews',   module: 'reviews' },
    { label: 'Reports',   route: '/rest-app/reports',       icon: 'reports',   module: 'reports' },
    { label: 'Support',   route: '/rest-app/support',       icon: 'support' },
    { label: 'Settings',  route: '/rest-app/settings',      icon: 'settings',  module: 'settings' },
  ];

  constructor(
    public auth: AuthenticationService,
    @Inject(DOCUMENT) private document: Document,
  ) {}

  /**
   * Lock background scroll while the mobile drawer is open. This only flips a
   * body class; a `<xl`-scoped CSS rule (styles.css) owns the actual lock, so
   * desktop — where `isOpen` just means the rail is expanded — is never locked
   * and no JS viewport check is needed.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      this.document.body.classList.toggle('dn-drawer-open', this.isOpen);
    }
  }

  ngOnDestroy(): void {
    this.document.body.classList.remove('dn-drawer-open');
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

  get chipName(): string {
    const p = this.auth.userValue?.profile;
    if (!p) return '';
    return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  }

  get chipRole(): string {
    return this.auth.currentRestaurantRole?.roles?.[0] ?? '';
  }
}
