import {
  AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { AuthenticationService } from '../../_services/authentication.service';
import {
  OwnerClaimError, OwnerClaimRedemption, OwnerClaimService, isOwnerClaimError,
} from '../../_services/owner-claim.service';
import { LoginResponse, Profile, RestaurantRole } from '../../_models/app.models';
import { firstAccessibleRoute } from '../../_helpers/module-access';

/**
 * The restaurant-portal owner-claim screen — the customer-plane half of backend
 * Phase-1 Step 2F.
 *
 *   claim code  ->  POST users/owner-claim/challenge/   (OTP to the owner's phone)
 *               ->  POST users/owner-claim/redeem/      (token + refresh + restaurant)
 *               ->  GET  users/user-profile/            (the canonical principal)
 *               ->  install the session, land on the claimed restaurant
 *
 * ═══ THE CLAIM CODE IS HELD IN MEMORY, ON THIS COMPONENT, AND NOWHERE ELSE ═════
 *
 * It is a ~288-bit bearer credential that establishes ownership of a restaurant, so
 * it never reaches a query string, a route parameter, a URL fragment, localStorage,
 * sessionStorage, a cookie, navigation state, analytics or a log. It lives in a
 * private field for this component's lifetime and is dropped in `ngOnDestroy`.
 *
 * The consequence is deliberate: a page refresh loses it and the owner pastes it
 * again. There is no delivery or claim-link architecture on the backend yet — the
 * operator hands the code over out of band — so persisting one to survive a reload
 * would be inventing durable storage for a credential the platform itself only
 * returns once.
 *
 * ═══ AN AMBIENT SESSION HAS NO INFLUENCE, AND IS NOT DISTURBED UNTIL SUCCESS ═══
 *
 * This route is public, so someone may already be signed in as a different operator.
 * Every claim call runs through `OwnerClaimService`, which bypasses the interceptors
 * (see its docstring), so the ambient token can neither ride along with the claim nor
 * displace the redemption token during bootstrap. And nothing local is cleared while
 * the claim is in flight: a failed claim leaves the existing session exactly as it
 * was. Only a fully bootstrapped principal replaces it, in one
 * `installAuthenticatedSessionAndReload` — which ends in a FULL PAGE LOAD, because
 * clearing storage does not evict the outgoing operator's data from the root
 * services that survive a soft navigation.
 *
 * ═══ NOTHING IS PERSISTED BEFORE THE PROFILE ARRIVES ═══════════════════════════
 *
 * Redemption returns tokens but no profile, and `AuthGuard` authorises off
 * `profile.restaurant_roles`. Persisting the tokens alone would produce a browser
 * that believes it is authenticated and has no memberships — every guarded route
 * bouncing it back to /login while a valid session sat in storage. So the redemption
 * result stays in `redemption` (memory) until the canonical profile is in hand.
 */

/** Where the flow is. Each stage owns one decision and one request. */
type ClaimStage =
  /** Paste the claim code. */
  | 'code'
  /** Enter the OTP, and choose a password when this is a brand-new identity. */
  | 'verify'
  /** Redemption has COMMITTED server-side; fetching the canonical profile. */
  | 'bootstrapping'
  /** Redemption committed, the profile did not arrive. Recoverable, retry-only. */
  | 'bootstrap-failed';

/** Resend cooldown, matching the login and forgot-password screens. */
const RESEND_COOLDOWN_SECONDS = 30;

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-owner-claim',
  standalone: true,
  imports: [FormsModule, RouterLink, AuthShellComponent],
  templateUrl: './owner-claim.component.html',
})
export class OwnerClaimComponent implements AfterViewChecked, OnDestroy {
  stage: ClaimStage = 'code';

  /** Bound to the stage-1 field. Trimmed into `claimToken` on a successful challenge. */
  claimCode = '';
  otp = '';
  newPassword = '';
  confirmPassword = '';

  /**
   * Whether redemption must carry a chosen password. STRAIGHT FROM THE CHALLENGE
   * RESPONSE — never inferred from anything else on this client.
   */
  credentialSetupRequired = false;

  busy = false;
  /** The one error sentence on screen. Backend wording wherever the backend sent any. */
  error: string | null = null;
  /** Django's configured password-validator messages, rendered by the password field. */
  passwordErrors: string[] = [];
  passwordMismatch = false;
  resendCountdown = 0;
  resendNotice: string | null = null;

  /**
   * The raw claim credential, captured only after the challenge proved it resolves.
   * Never rendered, never stored, never logged.
   */
  private claimToken: string | null = null;
  /**
   * The COMMITTED redemption, held only until the profile read succeeds. Its presence
   * is what makes `retryBootstrap()` safe: the claim is already durable server-side,
   * so recovery re-reads the profile and must never re-POST the redemption.
   */
  private redemption: OwnerClaimRedemption | null = null;

  /**
   * Tears down every in-flight claim request when the screen goes away.
   *
   * WITHOUT THIS, A RESPONSE CAN OUTLIVE THE SCREEN AND HIJACK THE SESSION. Angular
   * does not cancel an HTTP request when a component is destroyed — only
   * unsubscribing does — and `ngOnDestroy` clearing the fields does not help,
   * because `runBootstrap` closes over its `redemption` argument rather than
   * reading the field. So a profile response arriving after the user navigated away
   * would still call `completeWith`: installing the claimed session, replacing
   * whoever was signed in, and redirecting them off whatever page they had moved
   * to. The redeem subscription is worse still — its `next` STARTS the bootstrap
   * request, so a dead component would issue a fresh one.
   *
   * Applied to ALL FOUR requests rather than only the bootstrap: they are the same
   * defect, and leaving three of them unbound would fix an instance instead of the
   * cause. Cancelling an in-flight redeem loses nothing that was recoverable — the
   * screen it would have reported to is already gone, and the claim's durability is
   * the server's, which is exactly what the recovery copy tells the owner.
   */
  private readonly destroy$ = new Subject<void>();

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Set on every stage change; consumed once by ngAfterViewChecked. */
  private pendingFocus = true;

  constructor(
    private readonly claim: OwnerClaimService,
    private readonly auth: AuthenticationService,
    private readonly host: ElementRef<HTMLElement>,
  ) {}

  ngAfterViewChecked(): void {
    if (!this.pendingFocus) return;
    const target = this.host.nativeElement.querySelector<HTMLElement>('[data-autofocus]');
    if (!target) return;
    this.pendingFocus = false;
    target.focus();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCountdown();
    // Drop both credentials with the screen rather than letting them linger in a
    // detached component instance.
    this.claimToken = null;
    this.redemption = null;
  }

  // ── Stage 1 — the claim code ──────────────────────────────────────────────────

  get canSubmitCode(): boolean {
    return !this.busy && this.claimCode.trim().length > 0;
  }

  /**
   * Resolve the claim code and have the backend send the owner-claim OTP.
   *
   * The code is TRIMMED — it is base64url and can never legitimately carry
   * whitespace, so stray characters from a paste are the user's clipboard rather
   * than their credential. That is the opposite of the password below, which is
   * passed through untouched precisely because whitespace can be part of it.
   */
  submitCode(): void {
    if (!this.canSubmitCode) return;
    const token = this.claimCode.trim();
    this.beginRequest();
    this.claim.challenge(token).pipe(takeUntil(this.destroy$)).subscribe({
      next: (result) => {
        this.busy = false;
        this.claimToken = token;
        this.credentialSetupRequired = result.credentialSetupRequired;
        this.goTo('verify');
        this.startCountdown();
      },
      error: (failure: unknown) => this.failWith(failure),
    });
  }

  // ── Stage 2 — the OTP, and a password for a brand-new identity ────────────────

  get canSubmitVerification(): boolean {
    if (this.busy || !this.otp.trim()) return false;
    if (!this.credentialSetupRequired) return true;
    return this.newPassword.length > 0 && this.confirmPassword.length > 0;
  }

  /**
   * Spend the claim code and the OTP. On success the claim is COMMITTED server-side
   * and the flow moves straight into bootstrap — there is no path back to stage 2.
   */
  submitVerification(): void {
    if (!this.canSubmitVerification || !this.claimToken) return;

    // Client-side only, and only about the two boxes agreeing. The POLICY is
    // Django's configured validators; this check just avoids spending one of the
    // credential's five lifetime attempts on a typo the browser can already see.
    this.passwordMismatch = false;
    if (this.credentialSetupRequired && this.newPassword !== this.confirmPassword) {
      this.passwordMismatch = true;
      this.error = null;
      this.passwordErrors = [];
      return;
    }

    this.beginRequest();
    // The OTP is trimmed but never parsed as a number — a leading zero is
    // significant, so `01234` must stay a five-character string. The password is
    // NOT trimmed.
    this.claim
      .redeem(
        this.claimToken,
        this.otp.trim(),
        this.credentialSetupRequired ? this.newPassword : undefined,
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (redemption) => {
          this.stopCountdown();
          // The claim is now durable. The claim code has been spent and is dead, so
          // it is dropped here rather than kept around for a retry that must never
          // happen.
          this.claimToken = null;
          this.claimCode = '';
          this.newPassword = '';
          this.confirmPassword = '';
          this.otp = '';
          this.redemption = redemption;
          this.goTo('bootstrapping');
          this.runBootstrap(redemption);
        },
        error: (failure: unknown) => this.failWith(failure),
      });
  }

  /**
   * Ask for another owner-claim code.
   *
   * This calls the CLAIM challenge again, never `users/auth/resend-otp/`: that
   * endpoint issues a `login`-purpose OTP, and redemption binds its verification to
   * the `owner-claim` purpose, so a code from there could never be spent here.
   *
   * The screen deliberately says nothing about how many attempts remain — the
   * backend does not expose that, and progress reporting is worth more to a guesser
   * than to the owner.
   */
  resendCode(): void {
    if (this.busy || this.resendCountdown > 0 || !this.claimToken) return;
    this.beginRequest();
    this.resendNotice = null;
    this.claim.challenge(this.claimToken).pipe(takeUntil(this.destroy$)).subscribe({
      next: (result) => {
        this.busy = false;
        // Re-read rather than assumed: a reissue between the two challenges could
        // legitimately change which identity is being claimed.
        this.credentialSetupRequired = result.credentialSetupRequired;
        this.resendNotice = 'We sent another code to the phone number on your owner account.';
        this.startCountdown();
      },
      error: (failure: unknown) => this.failWith(failure),
    });
  }

  // ── Stage 3 — the canonical profile bootstrap ─────────────────────────────────

  /**
   * Retry the PROFILE READ ONLY.
   *
   * Redemption has already committed; re-POSTing it would spend an invitation that
   * is already consumed and come back as the generic refusal, which would read on
   * screen as "your claim failed" about a claim that succeeded.
   */
  retryBootstrap(): void {
    if (this.busy || !this.redemption) return;
    this.goTo('bootstrapping');
    this.runBootstrap(this.redemption);
  }

  /**
   * Whether some session is currently open on this device.
   *
   * Only used to tell the truth in the recovery copy below — never to decide who is
   * claiming, which is settled by the claim token alone.
   */
  get hasOpenSession(): boolean {
    return !!this.auth.userValue;
  }

  /**
   * The recovery escape hatch: get the claimant to the sign-in FORM.
   *
   * IT GOES THROUGH LOGOUT RATHER THAN A `routerLink` TO `/login`, and that is the
   * whole point. `/login` carries `loginRedirectGuard`, which forwards anyone who
   * already has a session AND a selected membership straight to their existing
   * landing. This panel deliberately leaves an ambient operator's session intact
   * when a claim's bootstrap fails — so on exactly the screen that promises "just
   * sign in normally", a plain link to `/login` would bounce the claimant to
   * somebody else's dashboard and give them no way to reach the form.
   *
   * `logout()` ends the ambient session properly (server-side refresh revocation,
   * storage cleared, hard redirect), so `/login` then renders for an unauthenticated
   * browser and the guard has nothing to redirect. With NO session open it is a
   * no-op that simply lands on `/login`.
   *
   * The claim itself is unaffected either way: it committed server-side before this
   * panel could appear.
   */
  signInInstead(): void {
    this.auth.logout();
  }

  private runBootstrap(redemption: OwnerClaimRedemption): void {
    this.beginRequest();
    this.claim.bootstrapProfile(redemption.token).pipe(takeUntil(this.destroy$)).subscribe({
      next: (profile) => {
        this.busy = false;
        this.completeWith(profile, redemption);
      },
      error: (failure: unknown) => {
        this.busy = false;
        this.error = isOwnerClaimError(failure)
          ? (failure as OwnerClaimError).message
          : 'Something went wrong. Please try again.';
        this.goTo('bootstrap-failed');
      },
    });
  }

  /**
   * Seat the session, having found the CLAIMED restaurant among the canonical
   * memberships.
   *
   * The membership object itself is used — the one the backend resolved, carrying its
   * `permissions` map. A hand-built `{restaurant_id, roles:['owner']}` would be a
   * guess about tenant authority that this client has no way to compute.
   *
   * IF IT IS ABSENT, THIS FAILS CLOSED. No session is persisted, no navigation
   * happens and `restaurant_roles[0]` is emphatically not substituted: the backend's
   * claim result and its membership resolver disagreeing is a real anomaly and
   * deserves to be seen, not smoothed over by seating the user at whichever
   * restaurant happened to sort first.
   */
  private completeWith(profile: Profile, redemption: OwnerClaimRedemption): void {
    const membership: RestaurantRole | undefined = (profile.restaurant_roles ?? [])
      .find((entry) => entry?.restaurant_id === redemption.restaurantId);

    if (!membership) {
      this.error = 'Your claim went through, but we couldn\'t load access to that '
        + 'restaurant yet. Please try again in a moment.';
      this.goTo('bootstrap-failed');
      return;
    }

    const completeSession: LoginResponse = {
      token: redemption.token,
      refresh: redemption.refresh,
      profile,
      // The claim-specific second factor has just been consumed; there is no further
      // verification pending.
      require_otp: false,
      // Read from the canonical profile rather than assumed. For a brand-new owner
      // the backend clears it as part of the redemption transaction, so it arrives
      // false; hard-coding that here would make this screen the authority on a fact
      // the server states.
      prompt_password_change: profile.prompt_password_change === true,
    };

    // The SAME landing authority ordinary login uses. Never a hard-coded /dashboard:
    // if a role's module defaults change, this must move with them. Computed BEFORE
    // the install, because it is the reload target and must not be re-derived from
    // storage afterwards. Note we do not divert to the password-change screen on
    // `prompt_password_change` the way login does — that screen needs the user's OLD
    // password, which a claim never collects.
    const landing = firstAccessibleRoute(membership.permissions, membership.roles);

    this.redemption = null;

    // A FULL PAGE LOAD, not `router.navigateByUrl`. This is the only place in the
    // flow where one operator replaces another, and a soft navigation would leave
    // every `providedIn: 'root'` service alive holding the OUTGOING tenant's data
    // (see the method's own docstring for the MenuService case). Reached only here:
    // an invalid claim, a wrong OTP, a rejected password, a pending redemption, a
    // failed bootstrap and a claimed restaurant missing from the profile all return
    // earlier and leave the ambient session exactly as it was.
    this.auth.installAuthenticatedSessionAndReload(completeSession, membership, landing);
  }

  // ── Shared plumbing ───────────────────────────────────────────────────────────

  private beginRequest(): void {
    this.busy = true;
    this.error = null;
    this.passwordErrors = [];
    this.passwordMismatch = false;
  }

  private failWith(failure: unknown): void {
    this.busy = false;
    if (!isOwnerClaimError(failure)) {
      this.error = 'Something went wrong. Please try again.';
      return;
    }
    const claimError = failure as OwnerClaimError;
    // The message is rendered as the backend wrote it. The refusal is deliberately
    // one sentence for every claim-state and verification outcome, so this screen
    // must not translate it into "code expired", "wrong code", "already claimed" or
    // anything else it cannot actually know.
    this.error = claimError.message;
    this.passwordErrors = claimError.passwordErrors ?? [];
  }

  private goTo(stage: ClaimStage): void {
    this.stage = stage;
    this.resendNotice = null;
    this.pendingFocus = true;
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.resendCountdown = RESEND_COOLDOWN_SECONDS;
    this.timer = setInterval(() => {
      if (this.resendCountdown > 0) {
        this.resendCountdown--;
      } else {
        this.stopCountdown();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.resendCountdown = 0;
  }
}
