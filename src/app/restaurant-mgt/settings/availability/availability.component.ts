import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { RestaurantDetail } from 'src/app/_models/app.models';

import {
  SectionPageComponent,
  SectionPageState,
} from '../components/section-page/section-page.component';
import { RestaurantAvailabilityService } from 'src/app/_services/restaurant-availability.service';

/**
 * Availability — the Settings section that controls whether the restaurant is
 * taking new orders. Ships a single `accepting_orders` toggle inside the shared
 * section-page scaffold; opening-hours scheduling is a later PR. Owner-only: the
 * restaurant is resolved from the authenticated membership, never a route param.
 *
 * Mirrors the Identity section's load/save lifecycle, but a single boolean needs
 * no reactive form — `app-dn-switch` is not a ControlValueAccessor — so dirty
 * tracking compares the staged value against the loaded one.
 */
@Component({
  selector: 'app-availability',
  standalone: true,
  imports: [CommonModule, SectionPageComponent, SwitchComponent],
  templateUrl: './availability.component.html',
})
export class AvailabilityComponent implements OnInit {
  loadState: SectionPageState = 'loading';
  saving = false;

  /** Staged toggle value bound to the switch. */
  acceptingOrders = true;
  /** Last loaded/saved value — drives the dirty comparison. */
  private loadedAcceptingOrders = true;

  private restaurantId = '';

  constructor(
    private auth: AuthenticationService,
    private svc: RestaurantAvailabilityService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.restaurantId = this.auth.currentRestaurantRole?.restaurant_id ?? '';
    if (!this.restaurantId) {
      this.loadState = 'error';
      return;
    }
    this.load();
  }

  /** Drives the scaffold's sticky save bar. */
  get isDirty(): boolean {
    return this.acceptingOrders !== this.loadedAcceptingOrders;
  }

  // ── Load / populate ────────────────────────────────────────────────────────

  load(): void {
    this.loadState = 'loading';
    this.svc.getDetail(this.restaurantId).subscribe({
      next: (detail) => {
        this.populate(detail);
        this.loadState = 'ready';
      },
      error: () => {
        this.loadState = 'error';
      },
    });
  }

  retry(): void {
    this.load();
  }

  private populate(detail: RestaurantDetail): void {
    // Default to accepting when the field is absent (backend default is true).
    this.loadedAcceptingOrders = detail.accepting_orders ?? true;
    this.acceptingOrders = this.loadedAcceptingOrders;
  }

  // ── Toggle / save / discard ──────────────────────────────────────────────────

  onToggle(value: boolean): void {
    this.acceptingOrders = value;
  }

  onDiscard(): void {
    this.acceptingOrders = this.loadedAcceptingOrders;
  }

  onSave(): void {
    this.saving = true;
    this.svc
      .save({ id: this.restaurantId, accepting_orders: this.acceptingOrders })
      .subscribe({
        next: () => this.onSaveSuccess(),
        error: () => {
          this.saving = false;
          // Clear the interceptor's queued toast so the user sees one clean
          // message, not two (matches the Identity/Tables/Support error pattern).
          this.toast.clear();
          this.toast.error('Could not save your changes. Please try again.');
        },
      });
  }

  private onSaveSuccess(): void {
    this.toast.success('Changes saved');
    // Re-fetch so the state reflects the server's canonical value, then reset
    // the dirty state. Keeps the scaffold in 'ready' (no skeleton).
    this.svc.getDetail(this.restaurantId).subscribe({
      next: (detail) => {
        this.populate(detail);
        this.saving = false;
      },
      error: () => {
        // Save succeeded; only the refresh failed. Sync local dirty state.
        this.loadedAcceptingOrders = this.acceptingOrders;
        this.saving = false;
      },
    });
  }
}
