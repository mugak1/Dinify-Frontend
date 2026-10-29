import { Injectable, inject, signal } from '@angular/core';
import { HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import { AuthenticationService } from '../../_services/authentication.service';
import { ApiService } from '../../_services/api.service';
import { SILENT_FAILURE } from '../../_helpers/error.interceptor';
import { Profile, RestaurantRole } from '../../_models/app.models';
import { SessionActionsService } from './session-actions.service';
import { landingPathFor } from './restaurant-landing';

/**
 * The venue switcher's one operation (SHELL-FINISH-00, PR 3).
 *
 *   confirm → re-read the canonical profile → find the membership IN IT →
 *   AuthenticationService.switchRestaurantAndReload (replace reload)
 *
 * A failed profile read (the server is off outside 11:00–23:00 London, or the
 * network dropped) shows an inline error and changes NOTHING. A membership that
 * no longer exists in the fresh profile is refused the same way: the list this
 * document shows was captured at sign-in and can be stale.
 */
@Injectable({ providedIn: 'root' })
export class RestaurantSwitchService {
  private readonly auth = inject(AuthenticationService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly sessionActions = inject(SessionActionsService);

  /** An inline error from the last attempt, or null. */
  readonly error = signal<string | null>(null);
  /** A switch is under way (the profile read is in flight). */
  readonly switching = signal(false);

  /** The memberships this document knows about (captured at sign-in). */
  memberships(): RestaurantRole[] {
    const roles = this.auth.userValue?.profile?.restaurant_roles;
    return Array.isArray(roles) ? roles : [];
  }

  currentRestaurantId(): string | null {
    return this.auth.currentRestaurantRole?.restaurant_id ?? null;
  }

  /** Ask once, then switch. Choosing the current restaurant does nothing. */
  requestSwitch(target: RestaurantRole): void {
    if (this.switching()) return;
    if (!target?.restaurant_id || target.restaurant_id === this.currentRestaurantId()) return;
    this.error.set(null);
    const dirty = this.sessionActions.hasUnsavedChanges();
    const name = target.restaurant || 'this restaurant';
    const others = 'Other Dinify tabs in this browser, including an open kitchen board, will switch too.';
    this.sessionActions.confirm(
      dirty
        ? {
            title: `Switch to ${name}?`,
            message: `You have unsaved changes on this page. They will be lost. ${others}`,
            tone: 'destructive',
            submitButtonText: 'Discard and switch',
            cancelButtonText: 'Keep editing',
          }
        : {
            title: `Switch to ${name}?`,
            message: others,
            tone: 'neutral',
            submitButtonText: 'Switch',
          },
      () => this.switchTo(target.restaurant_id, name),
    );
  }

  /** Re-read the profile and switch. Exposed for specs; the UI goes through requestSwitch. */
  switchTo(restaurantId: string, name: string): void {
    this.switching.set(true);
    this.api
      .get<{ profile?: Profile }>(null, 'users/user-profile/', {}, undefined,
        new HttpContext().set(SILENT_FAILURE, true))
      .subscribe({
        next: (response) => {
          const profile = readProfile(response?.data);
          if (!profile) {
            this.fail("Couldn't switch restaurants right now. Please try again.");
            return;
          }
          const membership = profile.restaurant_roles.find(r => r?.restaurant_id === restaurantId);
          if (!membership) {
            this.fail(`You no longer have access to ${name}. Nothing was changed.`);
            return;
          }
          this.auth.switchRestaurantAndReload(profile, membership, landingPathFor(this.router.url, membership))
            .then((outcome) => {
              if (outcome === 'principal-changed') {
                // Someone else is signed in to this browser now: write nothing,
                // and reload into whatever is stored.
                void this.auth.retireAndReload(landingPathFor(this.router.url, this.auth.currentRestaurantRole));
              }
            });
        },
        error: () => this.fail("Couldn't switch restaurants right now. Check your connection and try again."),
      });
  }

  private fail(message: string): void {
    this.switching.set(false);
    this.error.set(message);
  }
}

/** The canonical profile out of `GET users/user-profile/`, or null if it is not one. */
function readProfile(data: unknown): Profile | null {
  const profile = (data as { profile?: unknown } | null)?.profile as Profile | undefined;
  if (!profile || typeof profile !== 'object') return null;
  if (typeof profile.id !== 'string' || !profile.id) return null;
  if (!Array.isArray(profile.restaurant_roles)) return null;
  return profile;
}
