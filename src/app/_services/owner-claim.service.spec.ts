import { TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi, withXhr,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from 'src/environments/environment';
import {
  OWNER_CLAIM_TOKEN_HEADER, OwnerClaimError, OwnerClaimService,
} from './owner-claim.service';
import { AuthInterceptor } from '../_helpers/auth.interceptor';
import { AuthenticationService } from './authentication.service';

const BASE = `${environment.apiUrl}/api/${environment.version}`;
const CHALLENGE_URL = `${BASE}/users/owner-claim/challenge/`;
const REDEEM_URL = `${BASE}/users/owner-claim/redeem/`;
const PROFILE_URL = `${BASE}/users/user-profile/`;

const CLAIM_TOKEN = 'raw-claim-token-abc123';

/** A minimally complete canonical profile. */
function profileBody(restaurantRoles: unknown[] = []) {
  return {
    status: 200,
    message: 'Profile retrieved.',
    data: {
      profile: {
        id: 'u1', first_name: 'Asha', last_name: 'K', email: 'asha@test.ug',
        country: 'UG', roles: [], other_names: null, phone_number: '256700000000',
        prompt_password_change: false, restaurant_roles: restaurantRoles,
      },
    },
  };
}

describe('OwnerClaimService', () => {
  let service: OwnerClaimService;
  let httpMock: HttpTestingController;
  /** The DI-injected client — interceptors DO run on this one. */
  let interceptedHttp: HttpClient;

  /**
   * A STALE AMBIENT SESSION is present in every test here, on purpose. The claim
   * route is public, so a browser reaching it may already hold another operator's
   * token, and the whole point of the raw-backend design is that it has no effect.
   */
  const ambientUser = {
    token: 'AMBIENT-OPERATOR-TOKEN',
    refresh: 'ambient-refresh',
    profile: {
      id: 'other', first_name: 'Other', last_name: 'Operator', email: '',
      country: 'UG', roles: [], other_names: null, phone_number: '',
      prompt_password_change: false, restaurant_roles: [],
    },
    require_otp: false,
    prompt_password_change: false,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthenticationService,
          useValue: jasmine.createSpyObj('AuthenticationService', ['login'], {
            userValue: ambientUser,
          }),
        },
        // The REAL AuthInterceptor, wired exactly as app.module.ts wires it, so
        // "no Authorization header" is a statement about a live interceptor rather
        // than about one that was never registered.
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(OwnerClaimService);
    httpMock = TestBed.inject(HttpTestingController);
    interceptedHttp = TestBed.inject(HttpClient);
  });

  afterEach(() => httpMock.verify());

  // ── The negative control ──────────────────────────────────────────────────────
  // Without this, every "carries no Authorization" assertion below could pass
  // simply because the interceptor is not running in the TestBed at all.

  it('NEGATIVE CONTROL: the AuthInterceptor really is live and does attach the ambient token', () => {
    interceptedHttp.get(`${BASE}/anything/`).subscribe();
    const req = httpMock.expectOne(`${BASE}/anything/`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer AMBIENT-OPERATOR-TOKEN');
    req.flush({});
  });

  // ── challenge ─────────────────────────────────────────────────────────────────

  describe('challenge', () => {
    it('POSTs the claim token in X-Owner-Claim-Token and carries NO Authorization', () => {
      service.challenge(CLAIM_TOKEN).subscribe();
      const req = httpMock.expectOne(CHALLENGE_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get(OWNER_CLAIM_TOKEN_HEADER)).toBe(CLAIM_TOKEN);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({ status: 200, data: { credential_setup_required: true } });
    });

    it('never puts the claim token in the URL or the body', () => {
      service.challenge(CLAIM_TOKEN).subscribe();
      const req = httpMock.expectOne(CHALLENGE_URL);
      expect(req.request.urlWithParams).not.toContain(CLAIM_TOKEN);
      expect(JSON.stringify(req.request.body ?? {})).not.toContain(CLAIM_TOKEN);
      req.flush({ status: 200, data: { credential_setup_required: false } });
    });

    it('reads credential_setup_required straight from the response (true)', (done) => {
      service.challenge(CLAIM_TOKEN).subscribe((result) => {
        expect(result.credentialSetupRequired).toBeTrue();
        done();
      });
      httpMock.expectOne(CHALLENGE_URL)
        .flush({ status: 200, data: { credential_setup_required: true } });
    });

    it('reads credential_setup_required straight from the response (false)', (done) => {
      service.challenge(CLAIM_TOKEN).subscribe((result) => {
        expect(result.credentialSetupRequired).toBeFalse();
        done();
      });
      httpMock.expectOne(CHALLENGE_URL)
        .flush({ status: 200, data: { credential_setup_required: false } });
    });

    it('fails rather than defaulting when the boolean is absent', (done) => {
      // Defaulting either way is wrong: false strands a brand-new owner on a form
      // that cannot succeed, true makes an established owner send a password the
      // backend refuses.
      service.challenge(CLAIM_TOKEN).subscribe({
        error: (err: OwnerClaimError) => {
          expect(err.kind).toBe('malformed');
          done();
        },
      });
      httpMock.expectOne(CHALLENGE_URL).flush({ status: 200, data: {} });
    });
  });

  // ── redeem ────────────────────────────────────────────────────────────────────

  describe('redeem', () => {
    it('sends the claim token as a header and no Authorization', () => {
      service.redeem(CLAIM_TOKEN, '1234').subscribe();
      const req = httpMock.expectOne(REDEEM_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get(OWNER_CLAIM_TOKEN_HEADER)).toBe(CLAIM_TOKEN);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      expect(req.request.urlWithParams).not.toContain(CLAIM_TOKEN);
      expect(JSON.stringify(req.request.body)).not.toContain(CLAIM_TOKEN);
      req.flush({ data: { token: 't', refresh: 'r', restaurant_id: 'rid' } });
    });

    it('keeps the OTP a string, preserving a leading zero', () => {
      service.redeem(CLAIM_TOKEN, '0123').subscribe();
      const req = httpMock.expectOne(REDEEM_URL);
      expect(req.request.body.otp).toBe('0123');
      expect(typeof req.request.body.otp).toBe('string');
      req.flush({ data: { token: 't', refresh: 'r', restaurant_id: 'rid' } });
    });

    it('includes new_password for a brand-new owner, byte-for-byte untrimmed', () => {
      const password = '  spaced pass  ';
      service.redeem(CLAIM_TOKEN, '1234', password).subscribe();
      const req = httpMock.expectOne(REDEEM_URL);
      expect(req.request.body.new_password).toBe(password);
      req.flush({ data: { token: 't', refresh: 'r', restaurant_id: 'rid' } });
    });

    it('OMITS new_password entirely for an established owner', () => {
      // The backend REFUSES an unwanted password rather than ignoring it, so an
      // empty-string default here would fail an established owner's claim.
      service.redeem(CLAIM_TOKEN, '1234').subscribe();
      const req = httpMock.expectOne(REDEEM_URL);
      expect('new_password' in req.request.body).toBeFalse();
      req.flush({ data: { token: 't', refresh: 'r', restaurant_id: 'rid' } });
    });

    it('parses token, refresh and restaurant_id', (done) => {
      service.redeem(CLAIM_TOKEN, '1234').subscribe((result) => {
        expect(result).toEqual({ token: 'acc', refresh: 'ref', restaurantId: 'r-1' });
        done();
      });
      httpMock.expectOne(REDEEM_URL)
        .flush({ data: { token: 'acc', refresh: 'ref', restaurant_id: 'r-1' } });
    });

    it('rejects a success body missing any of the three fields', (done) => {
      service.redeem(CLAIM_TOKEN, '1234').subscribe({
        error: (err: OwnerClaimError) => {
          expect(err.kind).toBe('malformed');
          done();
        },
      });
      httpMock.expectOne(REDEEM_URL).flush({ data: { token: 'acc', refresh: 'ref' } });
    });
  });

  // ── bootstrapProfile ──────────────────────────────────────────────────────────

  describe('bootstrapProfile', () => {
    it('presents EXACTLY the redemption access token, never the ambient one', () => {
      // The defect this closes: AuthInterceptor would replace the header with the
      // previously persisted operator's token, and the claimant would be handed
      // somebody else's memberships and have them installed as their own session.
      service.bootstrapProfile('FRESH-REDEMPTION-TOKEN').subscribe();
      const req = httpMock.expectOne(PROFILE_URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer FRESH-REDEMPTION-TOKEN');
      expect(req.request.headers.get('Authorization')).not.toContain('AMBIENT');
      req.flush(profileBody());
    });

    it('does not send the claim token on the bootstrap read', () => {
      service.bootstrapProfile('FRESH-REDEMPTION-TOKEN').subscribe();
      const req = httpMock.expectOne(PROFILE_URL);
      expect(req.request.headers.has(OWNER_CLAIM_TOKEN_HEADER)).toBeFalse();
      req.flush(profileBody());
    });

    it('returns the canonical profile as sent', (done) => {
      const memberships = [{ restaurant_id: 'r-1', restaurant: 'Baba House', roles: ['owner'] }];
      service.bootstrapProfile('t').subscribe((profile) => {
        expect(profile.restaurant_roles).toEqual(memberships as never);
        expect(profile.prompt_password_change).toBeFalse();
        done();
      });
      httpMock.expectOne(PROFILE_URL).flush(profileBody(memberships));
    });

    it('rejects a profile with no restaurant_roles array', (done) => {
      // That array is the authority a session is seated from; without it there is
      // nothing to select the claimed membership out of.
      service.bootstrapProfile('t').subscribe({
        error: (err: OwnerClaimError) => {
          expect(err.kind).toBe('malformed');
          done();
        },
      });
      httpMock.expectOne(PROFILE_URL).flush({ data: { profile: { id: 'u1' } } });
    });
  });

  // ── error translation ─────────────────────────────────────────────────────────

  describe('error translation', () => {
    function failChallenge(
      body: Record<string, unknown> | null, status: number, done: (err: OwnerClaimError) => void,
    ) {
      service.challenge(CLAIM_TOKEN).subscribe({ error: done });
      httpMock.expectOne(CHALLENGE_URL)
        .flush(body, { status, statusText: 'err' });
    }

    it('relays the generic claim refusal VERBATIM and adds no diagnosis', (done) => {
      const sentence = 'This owner claim is invalid or no longer available.';
      failChallenge({ status: 400, message: sentence }, 400, (err) => {
        expect(err.kind).toBe('refused');
        expect(err.message).toBe(sentence);
        // The backend collapses expired / cancelled / consumed / locked / wrong-OTP
        // into that one sentence on purpose. Nothing here may un-collapse it.
        expect(err.message).not.toMatch(/expired|cancelled|locked|wrong|attempt/i);
        expect(err.passwordErrors).toBeUndefined();
        done();
      });
    });

    it('surfaces Django password-validator errors separately from the sentence', (done) => {
      service.redeem(CLAIM_TOKEN, '1234', 'abc').subscribe({
        error: (err: OwnerClaimError) => {
          expect(err.kind).toBe('password');
          expect(err.message).toBe('Please choose a password to finish claiming your account.');
          expect(err.passwordErrors).toEqual([
            'This password is too short. It must contain at least 8 characters.',
            'This password is too common.',
          ]);
          done();
        },
      });
      httpMock.expectOne(REDEEM_URL).flush({
        status: 400,
        message: 'Please choose a password to finish claiming your account.',
        errors: {
          new_password: [
            'This password is too short. It must contain at least 8 characters.',
            'This password is too common.',
          ],
        },
      }, { status: 400, statusText: 'Bad Request' });
    });

    it('maps 429 to rate_limited and relays the throttle detail', (done) => {
      failChallenge(
        { detail: 'Request was throttled. Expected available in 42 seconds.' }, 429,
        (err) => {
          expect(err.kind).toBe('rate_limited');
          expect(err.message).toContain('42 seconds');
          done();
        },
      );
    });

    it('maps the 500 OTP-delivery failure to server, with the backend sentence', (done) => {
      failChallenge(
        { status: 500, message: "We couldn't send your verification code. Please try again." },
        500,
        (err) => {
          expect(err.kind).toBe('server');
          expect(err.message).toBe("We couldn't send your verification code. Please try again.");
          done();
        },
      );
    });

    it('maps status 0 to offline', (done) => {
      service.challenge(CLAIM_TOKEN).subscribe({
        error: (err: OwnerClaimError) => {
          expect(err.kind).toBe('offline');
          expect(err.message).toContain('connection');
          done();
        },
      });
      httpMock.expectOne(CHALLENGE_URL)
        .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    });

    it('maps a 401 on the bootstrap read to unauthorized', (done) => {
      service.bootstrapProfile('stale').subscribe({
        error: (err: OwnerClaimError) => {
          expect(err.kind).toBe('unauthorized');
          done();
        },
      });
      httpMock.expectOne(PROFILE_URL)
        .flush({ detail: 'Given token not valid' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('falls back to its own sentence when the server sends no message', (done) => {
      failChallenge(null, 400, (err) => {
        expect(err.kind).toBe('refused');
        expect(err.message.length).toBeGreaterThan(0);
        done();
      });
    });
  });
});
