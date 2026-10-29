import { ChangeDetectionStrategy, Component, ElementRef, Output, EventEmitter, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthenticationService } from '../../../_services/authentication.service';
import { AvatarComponent, DN_MENU } from '../../../_shared/ui';
import { roleLabel } from '../../settings/team/members/staff-roles';
import { SessionActionsService } from '../session-actions.service';

// The dashboard date-range pills used to live here, gated on a
// `DashboardService.isDashboardActive$` flag that existed for no other reason. They moved
// into the dashboard's own page header in TIMEFRAME-01B — the timeframe is now owned by a
// route-scoped TimeframeService, which this global chrome cannot inject, and a control
// that only ever applied to one page did not belong in the shell anyway.
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, AvatarComponent, ...DN_MENU],
  templateUrl: './top-nav.component.html',
})
export class TopNavComponent {
  @Output() menuClick = new EventEmitter<void>();
  @Input() compact = false;
  /** Render the menu button: the shell sets this only in the drawer regime (below 1024). */
  @Input() showMenuButton = false;
  /** The drawer the menu button controls is open (its aria-expanded). */
  @Input() menuExpanded = false;

  @ViewChild('menuButton') private menuButton?: ElementRef<HTMLButtonElement>;

  constructor(
    private auth: AuthenticationService,
    private sessionActions: SessionActionsService,
  ) {}

  /**
   * The current restaurant's name, surfaced in the chrome so a multi-venue
   * operator always sees which venue they're editing (the shell fetches the
   * detail but rendered the name nowhere). Prefer the freshly-fetched detail
   * (`current_resta`, reflects an in-session rename); fall back to the
   * membership label (`rest_role.restaurant`), which is present immediately on
   * first paint before the detail request resolves.
   */
  /** Return focus to the menu button (Esc closing the drawer). */
  focusMenuButton(): void {
    this.menuButton?.nativeElement.focus();
  }

  /** The signed-in operator's name, from the canonical profile. */
  get userName(): string {
    const p = this.auth.userValue?.profile;
    if (!p) return '';
    return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  }

  /** The selected membership's role, through the one role vocabulary (`roleLabel`). */
  get userRole(): string {
    return roleLabel(this.auth.currentRestaurantRole?.roles?.[0]);
  }

  /** The avatar trigger's accessible name: the menu, and whose it is. */
  get accountLabel(): string {
    const who = [this.userName, this.userRole].filter(Boolean).join(', ');
    return who ? `Account menu: ${who}` : 'Account menu';
  }

  /** The one sign-out path (shared with /account): one confirmation, then logout. */
  signOut(): void {
    this.sessionActions.confirmSignOut();
  }

  get restaurantName(): string {
    return this.auth.currentRestaurant?.name || this.auth.currentRestaurantRole?.restaurant || '';
  }
}
