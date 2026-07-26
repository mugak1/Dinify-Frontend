import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthenticationService } from '../../../_services/authentication.service';

// The dashboard date-range pills used to live here, gated on a
// `DashboardService.isDashboardActive$` flag that existed for no other reason. They moved
// into the dashboard's own page header in TIMEFRAME-01B — the timeframe is now owned by a
// route-scoped TimeframeService, which this global chrome cannot inject, and a control
// that only ever applied to one page did not belong in the shell anyway.
@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './top-nav.component.html',
})
export class TopNavComponent {
  @Output() menuClick = new EventEmitter<void>();
  @Output() logoutClick = new EventEmitter<void>();
  @Input() compact = false;

  constructor(private auth: AuthenticationService) {}

  /**
   * The current restaurant's name, surfaced in the chrome so a multi-venue
   * operator always sees which venue they're editing (the shell fetches the
   * detail but rendered the name nowhere). Prefer the freshly-fetched detail
   * (`current_resta`, reflects an in-session rename); fall back to the
   * membership label (`rest_role.restaurant`), which is present immediately on
   * first paint before the detail request resolves.
   */
  get restaurantName(): string {
    return this.auth.currentRestaurant?.name || this.auth.currentRestaurantRole?.restaurant || '';
  }
}
