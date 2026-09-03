import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { environment } from 'src/environments/environment';

import { OwnerClaimComponent } from './owner-claim.component';
import { AuthenticationService } from '../../_services/authentication.service';
import { AuthInterceptor } from '../../_helpers/auth.interceptor';
import { OWNER_CLAIM_TOKEN_HEADER } from '../../_services/owner-claim.service';
import { LoginResponse, RestaurantRole } from '../../_models/app.models';

const BASE = `${environment.apiUrl}/api/${environment.version}`;
const CHALLENGE_URL = `${BASE}/users/owner-claim/challenge/`;
const REDEEM_URL = `${BASE}/users/owner-claim/redeem/`;
const PROFILE_URL = `${BASE}/users/user-profile/`;
const RESEND_OTP_URL = `${BASE}/users/auth/resend-otp/`;

const CLAIM_CODE = 'claim-code-xyz-987';
const CLAIMED_RESTAURANT = 'restaurant-B';

/** The membership the claim just created, as the backend resolves it. */
const CLAIMED_MEMBERSHIP: RestaurantRole = {
  restaurant_id: CLAIMED_RESTAURANT,
  restaurant: 'Baba House Kampala',
  roles: ['owner'],
  permissions: {
    dashboard: true, menu: true, tables: true, reviews: true,
    reports: true, settings: true, kitchen: true, billing: true, team: true,
  },
};

/** A restaurant the claimant already owned, to prove selection is not [0]. */
const EXISTING_MEMBERSHIP: RestaurantRole = {
  restaurant_id: 'restaurant-A',
  restaurant: 'The Old Place',
  roles: ['owner'],
  permissions: { dashboard: true, menu: true },
};

/** A previously signed-in, unrelated operator. */
const AMBIENT_SESSION: LoginResponse = {
  token: 'AMBIENT-OPERATOR-TOKEN',
  refresh: 'ambient-refresh',
  profile: {
    id: 'other-user', first_name: 'Other', last_name: 'Operator', email: '',
    country: 'UG', roles: [], other_names: null, phone_number: '',
    prompt_password_change: false,
    restaurant_roles: [{ restaurant_id: 'restaurant-Z', restaurant: 'Elsewhere', roles: ['manager'] }],
  },
  require_otp: false,
  prompt_password_change: false,
};

function profileBody(
  restaurantRoles: RestaurantRole[],
  promptPasswordChange = false,
) {
  return {
    status: 200,
    message: 'Profile retrieved.',
    data: {
      profile: {
        id: 'owner-1', first_name: 'Asha', last_name: 'Kagimu', email: 'asha@test.ug',
        country: 'UG', roles: [], other_names: null, phone_number: '256700000000',
        prompt_password_change: promptPasswordChange,
        restaurant_roles: restaurantRoles,
      },
    },
  };
}

describe('OwnerClaimComponent', () => {
  let fixture: ComponentFixture<OwnerClaimComponent>;
  let component: OwnerClaimComponent;
  let httpMock: HttpTestingController;
  let auth: AuthenticationService;
  let navigate: jasmine.Spy;

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Type through the DOM so the ngModel binding is exercised rather than bypassed.
   *
   * `await settle()` is not optional: NgModel registers its value accessor in a microtask,
   * so an input event dispatched before that resolves updates nothing, and every
   * assertion downstream then fails for a reason unrelated to the code under test.
   */
  async function typeInto(selector: string, value: string): Promise<void> {
    const input = el().querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no element for ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function submitForm(): Promise<void> {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Drive stage 1 into stage 2. */
  async function passChallenge(credentialSetupRequired: boolean): Promise<void> {
    await typeInto('#claim-code', CLAIM_CODE);
    await submitForm();
    httpMock.expectOne(CHALLENGE_URL).flush({
      status: 200, data: { credential_setup_required: credentialSetupRequired },
    });
    await settle();
  }

  beforeEach(async () => {
    localStorage.clear();
    // A DIFFERENT operator is already signed in for every test here: the claim route
    // is public, so this is the realistic starting state and the one most able to
    // corrupt the result.
    localStorage.setItem('user', JSON.stringify(AMBIENT_SESSION));

    TestBed.configureTestingModule({
      imports: [OwnerClaimComponent],
      providers: [
        provideRouter([]),
        // The real AuthInterceptor, exactly as app.module.ts wires it.
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthenticationService);
    navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);

    fixture = TestBed.createComponent(OwnerClaimComponent);
    component = fixture.componentInstance;
    await settle();
  });

  afterEach(() => {
    httpMock.verify();
    // Destroy before clearing storage so the component's resend interval is cleared.
    fixture.destroy();
    localStorage.clear();
  });

  // ── The claim credential ──────────────────────────────────────────────────────

  describe('the claim code as a credential', () => {
    it('never writes the claim code to localStorage, sessionStorage or a cookie', async () => {
      await passChallenge(true);

      const everywhere = [
        JSON.stringify(localStorage),
        JSON.stringify(sessionStorage),
        document.cookie,
      ].join('|');
      expect(everywhere).not.toContain(CLAIM_CODE);
    });

    it('sends the claim code ONLY in X-Owner-Claim-Token — never a URL or a body', async () => {
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();

      const req = httpMock.expectOne(CHALLENGE_URL);
      expect(req.request.headers.get(OWNER_CLAIM_TOKEN_HEADER)).toBe(CLAIM_CODE);
      expect(req.request.urlWithParams).not.toContain(CLAIM_CODE);
      expect(JSON.stringify(req.request.body ?? {})).not.toContain(CLAIM_CODE);
      req.flush({ status: 200, data: { credential_setup_required: false } });
    });

    it('carries NO Authorization header even though another operator is signed in', async () => {
      expect(auth.userValue?.token).toBe('AMBIENT-OPERATOR-TOKEN');

      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      const challenge = httpMock.expectOne(CHALLENGE_URL);
      expect(challenge.request.headers.has('Authorization')).toBeFalse();
      challenge.flush({ status: 200, data: { credential_setup_required: false } });
      await settle();

      await typeInto('#claim-otp', '1234');
      await submitForm();
      const redeem = httpMock.expectOne(REDEEM_URL);
      expect(redeem.request.headers.has('Authorization')).toBeFalse();
      redeem.flush({ data: { token: 'new', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });

      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });

    it('trims a pasted claim code but leaves the password untouched', async () => {
      await typeInto('#claim-code', `  ${CLAIM_CODE}  `);
      await submitForm();
      const challenge = httpMock.expectOne(CHALLENGE_URL);
      expect(challenge.request.headers.get(OWNER_CLAIM_TOKEN_HEADER)).toBe(CLAIM_CODE);
      challenge.flush({ status: 200, data: { credential_setup_required: true } });
      await settle();

      await typeInto('#claim-otp', '1234');
      await typeInto('#claim-password', '  keeps spaces  ');
      await typeInto('#claim-password-confirm', '  keeps spaces  ');
      await submitForm();

      const redeem = httpMock.expectOne(REDEEM_URL);
      expect(redeem.request.body.new_password).toBe('  keeps spaces  ');
      redeem.flush({ data: { token: 'n', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });
      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });
  });

  // ── Challenge ─────────────────────────────────────────────────────────────────

  describe('challenge', () => {
    it('shows the password fields when the server says a credential is required', async () => {
      await passChallenge(true);
      expect(el().querySelector('#claim-otp')).toBeTruthy();
      expect(el().querySelector('#claim-password')).toBeTruthy();
      expect(el().querySelector('#claim-password-confirm')).toBeTruthy();
    });

    it('shows NO password fields for an established owner', async () => {
      await passChallenge(false);
      expect(el().querySelector('#claim-otp')).toBeTruthy();
      expect(el().querySelector('#claim-password')).toBeNull();
      expect(el().querySelector('#claim-password-confirm')).toBeNull();
    });

    it('sends another code through the CLAIM endpoint, never users/auth/resend-otp/', async () => {
      // The owner-claim OTP has its own purpose; redemption binds verification to it,
      // so a login-purpose code from resend-otp could never be spent here.
      await passChallenge(false);
      component.resendCountdown = 0;
      await settle();

      el().querySelector<HTMLButtonElement>('button[type="button"]')!.click();
      await settle();

      httpMock.expectNone(RESEND_OTP_URL);
      const again = httpMock.expectOne(CHALLENGE_URL);
      expect(again.request.headers.get(OWNER_CLAIM_TOKEN_HEADER)).toBe(CLAIM_CODE);
      again.flush({ status: 200, data: { credential_setup_required: false } });
      await settle();
      expect(el().textContent).toContain('We sent another code');
    });

    it('holds the resend behind a countdown and never reports attempts remaining', async () => {
      await passChallenge(false);
      expect(component.resendCountdown).toBeGreaterThan(0);
      expect(el().textContent).toContain('Send another code in');
      // The backend does not expose the invitation attempt budget, and progress
      // reporting is worth more to a guesser than to the owner.
      expect(el().textContent).not.toMatch(/attempt|remaining|tries/i);
    });
  });

  // ── Redeem ────────────────────────────────────────────────────────────────────

  describe('redeem', () => {
    it('keeps the OTP a string and includes new_password for a brand-new owner', async () => {
      await passChallenge(true);
      await typeInto('#claim-otp', '0123');
      await typeInto('#claim-password', 'CorrectHorse9');
      await typeInto('#claim-password-confirm', 'CorrectHorse9');
      await submitForm();

      const req = httpMock.expectOne(REDEEM_URL);
      expect(req.request.body.otp).toBe('0123');
      expect(typeof req.request.body.otp).toBe('string');
      expect(req.request.body.new_password).toBe('CorrectHorse9');
      req.flush({ data: { token: 'n', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });
      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });

    it('OMITS new_password for an established owner', async () => {
      await passChallenge(false);
      await typeInto('#claim-otp', '1234');
      await submitForm();

      const req = httpMock.expectOne(REDEEM_URL);
      expect('new_password' in req.request.body).toBeFalse();
      req.flush({ data: { token: 'n', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });
      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });

    it('stops a password mismatch client-side, spending no attempt', async () => {
      await passChallenge(true);
      await typeInto('#claim-otp', '1234');
      await typeInto('#claim-password', 'CorrectHorse9');
      await typeInto('#claim-password-confirm', 'CorrectHorse8');
      await submitForm();

      httpMock.expectNone(REDEEM_URL);
      expect(component.passwordMismatch).toBeTrue();
      expect(el().textContent).toContain("The two passwords don't match.");
    });

    it('cannot double-submit — a second submit while in flight sends nothing', async () => {
      await passChallenge(false);
      await typeInto('#claim-otp', '1234');
      await submitForm();
      await submitForm();
      await submitForm();

      // Three submits, ONE request: `busy` gates the handler and the button is
      // disabled, so a double-tap cannot spend two of the credential's five
      // lifetime attempts.
      const requests = httpMock.match(REDEEM_URL);
      expect(requests.length).toBe(1);
      requests[0].flush({ data: { token: 'n', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });
      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });

    it('disables the submit button while the request is in flight', async () => {
      await passChallenge(false);
      await typeInto('#claim-otp', '1234');
      await submitForm();
      expect(el().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBeTrue();

      httpMock.expectOne(REDEEM_URL)
        .flush({ data: { token: 'n', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });
      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });
  });

  // ── Bootstrap + session install ───────────────────────────────────────────────

  describe('profile bootstrap', () => {
    async function redeemInto(restaurantId = CLAIMED_RESTAURANT): Promise<void> {
      await passChallenge(false);
      await typeInto('#claim-otp', '1234');
      await submitForm();
      httpMock.expectOne(REDEEM_URL).flush({
        data: { token: 'NEW-CLAIM-TOKEN', refresh: 'NEW-REFRESH', restaurant_id: restaurantId },
      });
      await settle();
    }

    it('presents the NEW redemption token, not the ambient operator token', async () => {
      await redeemInto();
      const req = httpMock.expectOne(PROFILE_URL);
      expect(req.request.headers.get('Authorization')).toBe('Bearer NEW-CLAIM-TOKEN');
      req.flush(profileBody([CLAIMED_MEMBERSHIP]));
    });

    it('persists NOTHING between redemption and the profile arriving', async () => {
      await redeemInto();
      // Redemption has committed and its tokens exist — but only in memory. A
      // half-session here would make AuthGuard believe the browser is authenticated
      // with no memberships to authorise against.
      const stored = localStorage.getItem('user');
      expect(stored).toBe(JSON.stringify(AMBIENT_SESSION));
      expect(stored).not.toContain('NEW-CLAIM-TOKEN');
      expect(localStorage.getItem('rest_role')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();

      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
    });

    it('installs the complete LoginResponse built from the canonical profile', async () => {
      await redeemInto();
      httpMock.expectOne(PROFILE_URL).flush(profileBody([EXISTING_MEMBERSHIP, CLAIMED_MEMBERSHIP]));

      const session = JSON.parse(localStorage.getItem('user')!) as LoginResponse;
      expect(session.token).toBe('NEW-CLAIM-TOKEN');
      expect(session.refresh).toBe('NEW-REFRESH');
      expect(session.require_otp).toBeFalse();
      expect(session.prompt_password_change).toBeFalse();
      expect(session.profile.id).toBe('owner-1');
      // Every membership survives — the claimant keeps the restaurants they had.
      expect(session.profile.restaurant_roles.length).toBe(2);
      expect(auth.userValue?.token).toBe('NEW-CLAIM-TOKEN');
    });

    it('takes prompt_password_change from the profile rather than hard-coding it', async () => {
      await redeemInto();
      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP], true));

      const session = JSON.parse(localStorage.getItem('user')!) as LoginResponse;
      expect(session.prompt_password_change).toBeTrue();
    });

    it('selects the CLAIMED membership from the canonical profile, not restaurant_roles[0]', async () => {
      await redeemInto();
      // The claimed restaurant is deliberately SECOND in the list.
      httpMock.expectOne(PROFILE_URL).flush(profileBody([EXISTING_MEMBERSHIP, CLAIMED_MEMBERSHIP]));

      const selected = JSON.parse(localStorage.getItem('rest_role')!) as RestaurantRole;
      expect(selected.restaurant_id).toBe(CLAIMED_RESTAURANT);
      expect(selected).toEqual(CLAIMED_MEMBERSHIP);
    });

    it('uses the backend-resolved membership object — it fabricates no roles or permissions', async () => {
      await redeemInto();
      const resolved: RestaurantRole = {
        restaurant_id: CLAIMED_RESTAURANT,
        restaurant: 'Baba House Kampala',
        // Deliberately NOT 'owner', and a restrictive map: if the component were
        // synthesising a membership from restaurant_id it would invent both.
        roles: ['manager'],
        permissions: { dashboard: false, menu: true },
      };
      httpMock.expectOne(PROFILE_URL).flush(profileBody([resolved]));

      const selected = JSON.parse(localStorage.getItem('rest_role')!) as RestaurantRole;
      expect(selected).toEqual(resolved);
      expect(selected.roles).toEqual(['manager']);
      expect(selected.permissions).toEqual({ dashboard: false, menu: true });
    });

    it('FAILS CLOSED when the claimed restaurant is not among the canonical memberships', async () => {
      await redeemInto('restaurant-NOT-IN-PROFILE');
      httpMock.expectOne(PROFILE_URL).flush(profileBody([EXISTING_MEMBERSHIP, CLAIMED_MEMBERSHIP]));
      await settle();

      // No session, no selection, no navigation — and emphatically not [0].
      expect(localStorage.getItem('user')).toBe(JSON.stringify(AMBIENT_SESSION));
      expect(localStorage.getItem('rest_role')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(component.stage).toBe('bootstrap-failed');
      expect(el().textContent).toContain('Retry');
    });

    it('retries the PROFILE READ ONLY after a bootstrap failure — never the redemption', async () => {
      await redeemInto();
      httpMock.expectOne(PROFILE_URL)
        .flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });
      await settle();
      expect(component.stage).toBe('bootstrap-failed');

      el().querySelector<HTMLButtonElement>('button[data-autofocus]')!.click();
      await settle();

      // Re-POSTing a consumed invitation would come back as the generic refusal and
      // read on screen as "your claim failed" about a claim that succeeded.
      httpMock.expectNone(REDEEM_URL);
      httpMock.expectNone(CHALLENGE_URL);
      const retry = httpMock.expectOne(PROFILE_URL);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer NEW-CLAIM-TOKEN');
      retry.flush(profileBody([CLAIMED_MEMBERSHIP]));

      expect(auth.userValue?.token).toBe('NEW-CLAIM-TOKEN');
    });
  });

  // ── Navigation ────────────────────────────────────────────────────────────────

  describe('post-claim landing', () => {
    async function completeClaimWith(membership: RestaurantRole, others: RestaurantRole[] = []): Promise<void> {
      await passChallenge(false);
      await typeInto('#claim-otp', '1234');
      await submitForm();
      httpMock.expectOne(REDEEM_URL).flush({
        data: { token: 'n', refresh: 'r', restaurant_id: membership.restaurant_id },
      });
      httpMock.expectOne(PROFILE_URL).flush(profileBody([...others, membership]));
      await settle();
    }

    it('lands on the first module the claimed membership can access', async () => {
      await completeClaimWith(CLAIMED_MEMBERSHIP);
      expect(navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('does NOT hard-code /dashboard — a membership without it lands on its first module', async () => {
      await completeClaimWith({
        ...CLAIMED_MEMBERSHIP,
        permissions: { dashboard: false, menu: true, tables: true },
      });
      expect(navigate).toHaveBeenCalledWith('/menu');
    });

    it('lands a membership with no accessible module on the shared no-module route', async () => {
      await completeClaimWith({
        ...CLAIMED_MEMBERSHIP,
        permissions: {
          dashboard: false, menu: false, tables: false, reviews: false,
          reports: false, settings: false, kitchen: false, billing: false, team: false,
        },
      });
      expect(navigate).toHaveBeenCalledWith('/account');
    });

    it('lands a multi-restaurant claimant on the JUST-CLAIMED restaurant, keeping the rest', async () => {
      await completeClaimWith(
        { ...CLAIMED_MEMBERSHIP, permissions: { dashboard: false, menu: false, tables: true } },
        [EXISTING_MEMBERSHIP],
      );

      // EXISTING_MEMBERSHIP would have landed on /dashboard; the claimed one is
      // tables-first. No restaurant selector is shown.
      expect(navigate).toHaveBeenCalledWith('/dining-tables');
      expect(auth.currentRestaurantRole.restaurant_id).toBe(CLAIMED_RESTAURANT);
      expect(auth.userValue?.profile.restaurant_roles.length).toBe(2);
    });
  });

  // ── Errors ────────────────────────────────────────────────────────────────────

  describe('errors', () => {
    it('renders the generic claim refusal verbatim and interprets nothing', async () => {
      const sentence = 'This owner claim is invalid or no longer available.';
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      httpMock.expectOne(CHALLENGE_URL)
        .flush({ status: 400, message: sentence }, { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(el().textContent).toContain(sentence);
      // The backend collapses expired / cancelled / consumed / locked / wrong-code
      // into that sentence deliberately. The screen must not un-collapse it.
      expect(el().textContent).not.toMatch(/expired|cancelled|revoked|locked|attempts remaining/i);
      expect(component.stage).toBe('code');
    });

    it('keeps the password-validator messages beside the password field', async () => {
      await passChallenge(true);
      await typeInto('#claim-otp', '1234');
      await typeInto('#claim-password', 'abc');
      await typeInto('#claim-password-confirm', 'abc');
      await submitForm();

      httpMock.expectOne(REDEEM_URL).flush({
        status: 400,
        message: 'Please choose a password to finish claiming your account.',
        errors: { new_password: ['This password is too short.', 'This password is too common.'] },
      }, { status: 400, statusText: 'Bad Request' });
      await settle();

      const list = el().querySelector('#claim-password-errors');
      expect(list?.textContent).toContain('This password is too short.');
      expect(list?.textContent).toContain('This password is too common.');
      expect(component.stage).toBe('verify');
    });

    it('shows the throttle message on a 429', async () => {
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      httpMock.expectOne(CHALLENGE_URL).flush(
        { detail: 'Request was throttled. Expected available in 42 seconds.' },
        { status: 429, statusText: 'Too Many Requests' },
      );
      await settle();
      expect(el().textContent).toContain('42 seconds');
    });

    it('shows the OTP-delivery failure sentence on a 500', async () => {
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      httpMock.expectOne(CHALLENGE_URL).flush(
        { status: 500, message: "We couldn't send your verification code. Please try again." },
        { status: 500, statusText: 'Server Error' },
      );
      await settle();
      expect(el().textContent).toContain("We couldn't send your verification code.");
    });

    it('shows an offline message on status 0', async () => {
      // ErrorInterceptor is bypassed on this channel, so the screen owns this.
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      httpMock.expectOne(CHALLENGE_URL)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
      await settle();
      expect(el().textContent).toContain('connection');
    });

    it('leaves the previously signed-in operator completely untouched on a failed claim', async () => {
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      httpMock.expectOne(CHALLENGE_URL).flush(
        { status: 400, message: 'This owner claim is invalid or no longer available.' },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle();

      expect(localStorage.getItem('user')).toBe(JSON.stringify(AMBIENT_SESSION));
      expect(auth.userValue?.token).toBe('AMBIENT-OPERATOR-TOKEN');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('replaces that operator only once the claim has fully bootstrapped', async () => {
      await passChallenge(false);
      await typeInto('#claim-otp', '1234');
      await submitForm();
      httpMock.expectOne(REDEEM_URL)
        .flush({ data: { token: 'n', refresh: 'r', restaurant_id: CLAIMED_RESTAURANT } });
      expect(auth.userValue?.token).toBe('AMBIENT-OPERATOR-TOKEN');

      httpMock.expectOne(PROFILE_URL).flush(profileBody([CLAIMED_MEMBERSHIP]));
      expect(auth.userValue?.token).toBe('n');
      expect(auth.userValue?.profile.id).toBe('owner-1');
    });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('labels every field and uses the right autocomplete tokens', async () => {
      await passChallenge(true);
      const otp = el().querySelector<HTMLInputElement>('#claim-otp')!;
      expect(el().querySelector('label[for="claim-otp"]')).toBeTruthy();
      expect(otp.getAttribute('autocomplete')).toBe('one-time-code');
      expect(otp.getAttribute('inputmode')).toBe('numeric');

      expect(el().querySelector('label[for="claim-password"]')).toBeTruthy();
      expect(el().querySelector('#claim-password')!.getAttribute('autocomplete')).toBe('new-password');
      expect(el().querySelector('label[for="claim-password-confirm"]')).toBeTruthy();
    });

    it('announces the error and points the field at it', async () => {
      await typeInto('#claim-code', CLAIM_CODE);
      await submitForm();
      httpMock.expectOne(CHALLENGE_URL)
        .flush({ status: 400, message: 'Nope.' }, { status: 400, statusText: 'Bad Request' });
      await settle();

      const alert = el().querySelector('#claim-error');
      expect(alert?.getAttribute('role')).toBe('alert');
      const input = el().querySelector<HTMLInputElement>('#claim-code')!;
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe('claim-error');
    });

    it('moves focus to the first actionable field when the stage changes', async () => {
      expect(document.activeElement?.id).toBe('claim-code');
      await passChallenge(false);
      expect(document.activeElement?.id).toBe('claim-otp');
    });
  });
});
