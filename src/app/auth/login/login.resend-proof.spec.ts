/**
 * D11 E-R4 — A LOGIN RESEND CARRIES THE PROOF FROM THE LOGIN THAT ISSUED THE CODE.
 *
 * The paired Backend change refuses a `purpose: 'login'` resend unless it carries
 * the `login_resend_proof` the server returned from a successful password login on
 * the OTP branch. The server returns that proof only when the login opted in with
 * `login_resend_protocol: 'v1'`. This file pins the consumer half: what this
 * screen sends, where the proof lives, and when it stops existing.
 *
 * EVERYTHING HERE RUNS THE REAL CHAIN exactly as `app.module.ts` registers it:
 * `AuthInterceptor` → `DinerSessionInterceptor` → `ErrorInterceptor`, class
 * based, `withXhr()` + `withInterceptorsFromDi()`, over the real
 * `AuthenticationService`, `ApiService`-free `HttpClient` calls and the real
 * `ToastService`. The screen is driven through its rendered DOM where a person
 * can drive it: the password is typed, Sign in, Verify, Resend and Back are
 * clicked, and the code is typed into the four OTP boxes. Server answers are
 * SYNTHETIC; their bodies are the ones the Backend endpoints write.
 *
 * WHERE A STEP IS CALLED DIRECTLY it is because no person can reach it through
 * the screen, and the spec says so: a second Sign in while the first is pending
 * (the button is disabled while loading) and Back while a code is being verified
 * (Back is disabled then). Those are defence in depth, labelled CONSTRUCTED.
 *
 * WHAT "CANCELLED" PROVES. Ending a login attempt unsubscribes its pending
 * requests, and that is the only thing that keeps an old answer away from the
 * screen. The specs assert the request was cancelled AND, where it was not,
 * deliver the old answer anyway (`deliverIfLive`) before asserting that nothing
 * the old attempt owned happened. So a regression shows up as the behaviour it
 * allows, not only as a flag. Cancellation stops this screen acting on an answer;
 * it does NOT prove the server never processed a request already sent.
 *
 * The proof values are never real signatures. They are distinctive strings, so a
 * leak into storage, router state or a log line is unambiguous wherever it lands.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  HTTP_INTERCEPTORS,
  provideHttpClient,
  withInterceptorsFromDi,
  withXhr,
} from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, RouterLink, provideRouter } from '@angular/router';
import { config } from 'rxjs';

import { environment } from 'src/environments/environment';
import { AuthInterceptor } from 'src/app/_helpers/auth.interceptor';
import { DinerSessionInterceptor } from 'src/app/_helpers/diner-session.interceptor';
import { ErrorInterceptor } from 'src/app/_helpers/error.interceptor';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ConnectivityService } from 'src/app/_services/connectivity.service';
import { WINDOW } from 'src/app/_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from 'src/app/_services/storage/storage-key-prefix.token';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { DinifyCommonModule } from 'src/app/_common/dinify-common.module';
import { DinifyPhoneInputComponent } from 'src/app/shared/dinify-phone-input/dinify-phone-input.component';
import { LoginComponent } from './login.component';

const API = `${environment.apiUrl}/api/${environment.version}`;
const LOGIN = `${API}/users/auth/login/`;
const VERIFY = `${API}/users/auth/verify-otp/`;
const RESEND = `${API}/users/auth/resend-otp/`;

const MSISDN = '256700111222';
const PASSWORD = 'Secret#123';
const PROOF_A = 'v1.SPEC-PROOF-attempt-A-not-a-real-signature-00';
const PROOF_B = 'v1.SPEC-PROOF-attempt-B-not-a-real-signature-00';

// The Backend's existing refusal copy for a login resend it will not honour
// (`otp_manager.LOGIN_RESEND_REFUSAL`, unchanged by E-R4).
const REFUSAL = 'Please provide your username and password again to get a login OTP';

const OWNER = { restaurant_id: 'r1', restaurant: 'Spec Kitchen', roles: ['owner'] };

function profile(id = 'user-1') {
  return {
    id, first_name: 'Amara', last_name: 'Okello', email: '', roles: [],
    phone_number: MSISDN, country: 'UG', prompt_password_change: false,
    other_names: '', restaurant_roles: [OWNER],
  };
}

/** The OTP branch of `users/auth/login/`: no token, a profile, maybe a proof. */
function otpBranch(proof?: string, id = 'user-1') {
  const data: Record<string, unknown> = { require_otp: true, prompt_password_change: false, profile: profile(id) };
  if (proof !== undefined) data['login_resend_proof'] = proof;
  return { status: 200, message: 'Login successful', data };
}

describe('LoginComponent: D11 E-R4 requester-bound login resend (real chain)', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let http: HttpTestingController;
  let toast: ToastService;
  let auth: AuthenticationService;
  let router: Router;
  let unhandled: unknown[];
  let previousOnUnhandled: typeof config.onUnhandledError;
  let consoleSpies: jasmine.Spy[];

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const heldProof = () => (component as any).loginResendProof as string | null;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    unhandled = [];
    previousOnUnhandled = config.onUnhandledError;
    config.onUnhandledError = (err) => unhandled.push(err);

    await TestBed.configureTestingModule({
      declarations: [LoginComponent],
      imports: [ReactiveFormsModule, FormsModule, DinifyCommonModule, DinifyPhoneInputComponent, RouterLink],
      providers: [
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: DinerSessionInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    auth = TestBed.inject(AuthenticationService);
    router = TestBed.inject(Router);
    spyOn(toast, 'error').and.callThrough();
    spyOn(toast, 'warning').and.callThrough();
    spyOn(toast, 'success').and.callThrough();
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    // logout() ends in a full page load; record it instead of leaving the runner.
    spyOn<any>(auth, 'hardRedirect');
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map((m) => spyOn(console, m).and.callThrough());

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    await settle();
    config.onUnhandledError = previousOnUnhandled;
    expect(unhandled).withContext('unhandled RxJS errors').toEqual([]);
    http.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DOM drivers ──────────────────────────────────────────────────────────

  function buttonLabelled(label: string): HTMLButtonElement {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const button = buttons.find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === label);
    if (!button) throw new Error(`no button labelled "${label}"`);
    return button;
  }

  function hasButton(label: string): boolean {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    return buttons.some((b) => b.textContent?.replace(/\s+/g, ' ').trim() === label);
  }

  /** Type the number (as the phone input emits it) and the password, then press Sign in. */
  function signIn(): void {
    component.onInputChange({ phoneNumber: MSISDN });
    const password = fixture.nativeElement.querySelector('#password') as HTMLInputElement;
    password.value = PASSWORD;
    password.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    buttonLabelled('Sign in').click();
  }

  function answerLogin(body: object): TestRequest {
    const req = http.expectOne(LOGIN);
    expect(req.request.method).toBe('POST');
    req.flush(body);
    fixture.detectChanges();
    return req;
  }

  /** Sign in and answer on the OTP branch, landing on the code screen. */
  function reachOtpScreen(proof?: string, id = 'user-1'): void {
    signIn();
    answerLogin(otpBranch(proof, id));
    expect(component.require_otp).withContext('premise: on the OTP screen').toBeTrue();
  }

  async function enterOtp(code: string): Promise<void> {
    // NgModel writes the screen's current `data` into the boxes in a microtask
    // after they render (and again after an invalid code clears it). Typing
    // before that write lands would be wiped by it, as it would for a person
    // who could type that fast.
    await settle();
    fixture.detectChanges();
    const boxes = Array.from(fixture.nativeElement.querySelectorAll('app-otp-input input')) as HTMLInputElement[];
    expect(boxes.length).withContext('premise: four OTP boxes').toBe(4);
    code.split('').forEach((digit, i) => {
      boxes[i].value = digit;
      boxes[i].dispatchEvent(new Event('input'));
    });
    await settle();
    fixture.detectChanges();
  }

  function pressVerify(): void {
    const verify = buttonLabelled('Verify OTP');
    expect(verify.disabled).withContext('premise: Verify is enabled').toBeFalse();
    verify.click();
    fixture.detectChanges();
  }

  function pressResend(): TestRequest {
    component.countdown = 0;
    fixture.detectChanges();
    buttonLabelled('Resend').click();
    fixture.detectChanges();
    const req = http.expectOne(RESEND);
    expect(req.request.method).toBe('POST');
    return req;
  }

  function pressBack(): void {
    buttonLabelled('Back to sign in').click();
    fixture.detectChanges();
  }

  /**
   * Answers a request the screen should have cancelled, if it was not. With the
   * cancellation in place this does nothing; without it, the old answer reaches
   * the screen and the assertions after it see what that answer did.
   */
  function deliverIfLive(req: TestRequest, body: object): void {
    if (!req.cancelled) {
      req.flush(body);
      fixture.detectChanges();
    }
  }

  /** No proof (and no fragment of one) anywhere the screen persists, routes or logs. */
  function assertProofNowhere(...proofs: string[]): void {
    const stores: Storage[] = [localStorage, sessionStorage];
    for (const store of stores) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)!;
        const value = store.getItem(key) ?? '';
        for (const p of proofs) {
          expect(key.includes(p) || value.includes(p)).withContext(`storage key ${key}`).toBeFalse();
        }
      }
    }
    const navCalls = [
      ...(router.navigate as jasmine.Spy).calls.allArgs(),
      ...(router.navigateByUrl as jasmine.Spy).calls.allArgs(),
    ];
    const logged = consoleSpies.flatMap((s) => s.calls.allArgs());
    for (const p of proofs) {
      expect(JSON.stringify(navCalls)).withContext('router arguments').not.toContain(p);
      expect(logged.map((args) => args.map(String).join(' ')).join('\n'))
        .withContext('console output').not.toContain(p);
      expect(JSON.stringify(auth.userValue ?? null)).withContext('published user').not.toContain(p);
      expect(JSON.stringify(component.log_in ?? null)).withContext('log_in').not.toContain(p);
    }
  }

  // ── The login body ───────────────────────────────────────────────────────

  describe('the login body', () => {
    it('CONTRACT: the restaurant sign-in sends exactly {username, password, login_resend_protocol: "v1"}', () => {
      signIn();
      const req = http.expectOne(LOGIN);
      expect(req.request.body).toEqual({ username: MSISDN, password: PASSWORD, login_resend_protocol: 'v1' });
      req.flush(otpBranch(PROOF_A));
    });

    it('CONTROL: the diner sign-in sends exactly {username, password, source: "diner"}, with no capability', () => {
      component.as_diner = true;
      const emitted: unknown[] = [];
      component.LoginResp.subscribe((v) => emitted.push(v));
      signIn();
      const req = http.expectOne(LOGIN);
      expect(req.request.body).toEqual({ username: MSISDN, password: PASSWORD, source: 'diner' });
      req.flush({
        status: 200, message: 'Login successful',
        data: { token: 'jwt', refresh: 'ref', require_otp: false, prompt_password_change: false, profile: profile() },
      });
      expect(emitted).toEqual([true]);
      expect(heldProof()).toBeNull();
    });

    it('a diner login answered (unexpectedly) with a proof holds and stores none of it', () => {
      component.as_diner = true;
      signIn();
      http.expectOne(LOGIN).flush({
        status: 200, message: 'Login successful',
        data: {
          token: 'jwt', refresh: 'ref', require_otp: false, prompt_password_change: false,
          profile: profile(), login_resend_proof: PROOF_A,
        },
      });
      expect(heldProof()).toBeNull();
      expect(auth.userValue?.token).toBe('jwt');
      assertProofNowhere(PROOF_A);
    });
  });

  // ── The proof on the OTP branch ──────────────────────────────────────────

  describe('the OTP branch', () => {
    it('holds the proof privately: not in log_in, storage, the published user, router state or logs', () => {
      reachOtpScreen(PROOF_A);
      expect(heldProof()).toBe(PROOF_A);
      expect('login_resend_proof' in (component.log_in as any)).toBeFalse();
      expect(component.log_in.profile.id).toBe('user-1');
      expect(auth.userValue).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
      assertProofNowhere(PROOF_A);
    });

    it('CONTRACT: Resend echoes the proof verbatim, and the server message is shown', () => {
      reachOtpScreen(PROOF_A);
      const req = pressResend();
      expect(req.request.body).toEqual({
        identification: 'id', identifier: 'user-1', purpose: 'login', login_resend_proof: PROOF_A,
      });
      req.flush({ status: 200, message: 'A new OTP has been sent' });
      expect(toast.success).toHaveBeenCalledOnceWith('A new OTP has been sent');
      expect(toast.error).not.toHaveBeenCalled();
      assertProofNowhere(PROOF_A);
    });

    it('repeated genuine resends carry the same proof each time', () => {
      reachOtpScreen(PROOF_A);
      for (let i = 0; i < 3; i++) {
        const req = pressResend();
        expect(req.request.body.login_resend_proof).toBe(PROOF_A);
        req.flush({ status: 200, message: 'A new OTP has been sent' });
      }
      expect(toast.success).toHaveBeenCalledTimes(3);
      expect(heldProof()).toBe(PROOF_A);
    });

    it('an empty-string proof is not a proof: the resend sends the old body', () => {
      reachOtpScreen('');
      expect(heldProof()).toBeNull();
      const req = pressResend();
      expect(req.request.body).toEqual({ identification: 'id', identifier: 'user-1', purpose: 'login' });
      req.flush({ status: 200, message: 'A new OTP has been sent' });
    });

    it('a resend refused with the existing copy shows exactly that toast, and the code still completes sign-in', async () => {
      reachOtpScreen(PROOF_A);
      const req = pressResend();
      req.flush({ status: 400, message: REFUSAL }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(toast.error).toHaveBeenCalledOnceWith(REFUSAL);
      expect(toast.success).not.toHaveBeenCalled();
      expect(component.require_otp).withContext('still on the code screen').toBeTrue();
      expect(hasButton('Verify OTP')).toBeTrue();

      await enterOtp('1234');
      pressVerify();
      const verify = http.expectOne(VERIFY);
      expect(verify.request.body).toEqual({ user: 'user-1', otp: '1234' });
      verify.flush({ status: 200, message: 'OTP verified', data: { valid: true, token: 'jwt', refresh: 'ref' } });

      expect(auth.userValue?.token).toBe('jwt');
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard');
      expect(heldProof()).toBeNull();
      assertProofNowhere(PROOF_A);
    });

    it('CONTROL: a rate-limited resend sets the rate-limit state and keeps the proof', () => {
      reachOtpScreen(PROOF_A);
      const req = pressResend();
      req.flush({ status: 429, message: 'Too many requests' }, { status: 429, statusText: 'Too Many Requests' });
      expect(component.rateLimited).toBeTrue();
      expect(toast.warning).toHaveBeenCalledOnceWith('Too many requests');
      expect(toast.error).not.toHaveBeenCalled();
      expect(heldProof()).toBe(PROOF_A);
    });
  });

  // ── Old, new and rolled-back servers ─────────────────────────────────────

  describe('compatibility', () => {
    it('OLD or ROLLED-BACK backend: no proof comes back, and Resend sends exactly the old body', () => {
      reachOtpScreen(undefined);
      expect(heldProof()).toBeNull();
      const req = pressResend();
      expect(req.request.body).toEqual({ identification: 'id', identifier: 'user-1', purpose: 'login' });
      req.flush({ status: 200, message: 'A new OTP has been sent' });
      expect(toast.success).toHaveBeenCalledOnceWith('A new OTP has been sent');
    });

    it('a proof-less login meeting an upgraded backend: the refusal shows, and signing in again restores a bound resend', () => {
      reachOtpScreen(undefined);
      const legacy = pressResend();
      expect('login_resend_proof' in legacy.request.body).toBeFalse();
      legacy.flush({ status: 400, message: REFUSAL }, { status: 400, statusText: 'Bad Request' });
      expect(toast.error).toHaveBeenCalledOnceWith(REFUSAL);

      pressBack();
      reachOtpScreen(PROOF_B);
      const bound = pressResend();
      expect(bound.request.body.login_resend_proof).toBe(PROOF_B);
      bound.flush({ status: 200, message: 'A new OTP has been sent' });
    });

    it('a proof minted before a backend rollback is still sent; the old server answering 200 is honoured', () => {
      reachOtpScreen(PROOF_A);
      const req = pressResend();
      expect(req.request.body.login_resend_proof).toBe(PROOF_A);
      req.flush({ status: 200, message: 'OTP sent' });
      expect(toast.success).toHaveBeenCalledOnceWith('OTP sent');
    });
  });

  // ── The other login branches ─────────────────────────────────────────────

  describe('the other login branches', () => {
    it('password change: no proof is held, and none reaches the lock-screen router state', () => {
      signIn();
      answerLogin({
        status: 200, message: 'Password change required',
        data: { require_otp: false, prompt_password_change: true, profile: profile(), login_resend_proof: PROOF_A },
      });
      expect(router.navigate).toHaveBeenCalledTimes(1);
      const [commands] = (router.navigate as jasmine.Spy).calls.mostRecent().args;
      expect(commands).toEqual(['lock-otp-exp']);
      expect(heldProof()).toBeNull();
      assertProofNowhere(PROOF_A);
    });

    it('token branch with an unexpected proof: the stored session is a copy without it, and nothing is held', () => {
      signIn();
      answerLogin({
        status: 200, message: 'Login successful',
        data: {
          token: 'jwt', refresh: 'ref', require_otp: false, prompt_password_change: false,
          profile: profile(), login_resend_proof: PROOF_A,
        },
      });
      expect(auth.userValue?.token).toBe('jwt');
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard');
      expect(heldProof()).toBeNull();
      assertProofNowhere(PROOF_A);
    });
  });

  // ── When the proof stops existing ────────────────────────────────────────

  describe('the attempt boundaries', () => {
    it('Back clears the proof and cancels a resend still in flight', () => {
      reachOtpScreen(PROOF_A);
      const resend = pressResend();
      pressBack();
      expect(resend.cancelled).withContext('resend cancelled').toBeTrue();
      deliverIfLive(resend, { status: 200, message: 'A new OTP has been sent' });
      expect(heldProof()).toBeNull();
      expect(component.require_otp).toBeFalse();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('a new sign-in after Back holds only the new proof, and its resend carries it', () => {
      reachOtpScreen(PROOF_A);
      pressBack();
      reachOtpScreen(PROOF_B, 'user-2');
      expect(heldProof()).toBe(PROOF_B);
      const req = pressResend();
      expect(req.request.body).toEqual({
        identification: 'id', identifier: 'user-2', purpose: 'login', login_resend_proof: PROOF_B,
      });
      req.flush({ status: 200, message: 'A new OTP has been sent' });
    });

    it('a successful code clears the proof and cancels a resend still in flight', async () => {
      reachOtpScreen(PROOF_A);
      const resend = pressResend();
      await enterOtp('1234');
      pressVerify();
      http.expectOne(VERIFY).flush({ status: 200, message: 'OTP verified', data: { valid: true, token: 'jwt', refresh: 'ref' } });

      expect(resend.cancelled).withContext('resend cancelled').toBeTrue();
      deliverIfLive(resend, { status: 200, message: 'A new OTP has been sent' });
      expect(heldProof()).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard');
      expect(toast.success).not.toHaveBeenCalled();
      assertProofNowhere(PROOF_A);
    });

    it('PRESERVED: three invalid codes keep the screen and the proof; the FOURTH resets and clears it', async () => {
      reachOtpScreen(PROOF_A);
      for (let i = 1; i <= 3; i++) {
        await enterOtp('0000');
        pressVerify();
        http.expectOne(VERIFY).flush({ status: 200, message: 'Invalid OTP', data: { valid: false } });
        fixture.detectChanges();
        expect(component.require_otp).withContext(`after invalid #${i}`).toBeTrue();
        expect(heldProof()).withContext(`after invalid #${i}`).toBe(PROOF_A);
        expect(auth['hardRedirect']).not.toHaveBeenCalled();
      }
      await enterOtp('0000');
      pressVerify();
      http.expectOne(VERIFY).flush({ status: 200, message: 'Invalid OTP', data: { valid: false } });
      fixture.detectChanges();

      expect(component.require_otp).withContext('after invalid #4').toBeFalse();
      expect(heldProof()).toBeNull();
      expect(toast.error).toHaveBeenCalledWith('You have exceeded the maximum number of attempts. Please try again later.');
      expect((toast.error as jasmine.Spy).calls.allArgs().filter(
        ([m]) => m === 'The OTP provided is invalid. Please try again.')).toEqual([
        ['The OTP provided is invalid. Please try again.'],
        ['The OTP provided is invalid. Please try again.'],
        ['The OTP provided is invalid. Please try again.'],
      ]);
      expect(auth['hardRedirect']).toHaveBeenCalledOnceWith('/login');
    });

    it('destroying the screen clears the proof and cancels its pending resend', () => {
      reachOtpScreen(PROOF_A);
      const resend = pressResend();
      fixture.destroy();
      expect(resend.cancelled).toBeTrue();
      if (!resend.cancelled) { resend.flush({ status: 200, message: 'A new OTP has been sent' }); }
      expect(heldProof()).toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('destroying the screen during sign-in cancels the login: nothing is stored, held or routed', () => {
      signIn();
      const login = http.expectOne(LOGIN);
      fixture.destroy();
      expect(login.cancelled).toBeTrue();
      if (!login.cancelled) { login.flush(otpBranch(PROOF_A)); }
      expect(heldProof()).toBeNull();
      expect(component.require_otp).toBeFalse();
      expect(localStorage.getItem('user')).toBeNull();
      expect(router.navigate).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('destroying the screen while a code is verified cancels it: no tokens adopted, no navigation', async () => {
      reachOtpScreen(PROOF_A);
      await enterOtp('1234');
      pressVerify();
      const verify = http.expectOne(VERIFY);
      fixture.destroy();
      expect(verify.cancelled).toBeTrue();
      if (!verify.cancelled) {
        verify.flush({ status: 200, message: 'OTP verified', data: { valid: true, token: 'jwt-A', refresh: 'ref-A' } });
      }
      expect(auth.userValue).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('CONSTRUCTED: a second sign-in while the first is pending cancels the first; only the second is answered', () => {
      // Sign in is disabled while loading, so this is reached only by calling the method.
      signIn();
      const first = http.expectOne(LOGIN);
      component.onSubmit();
      const second = http.expectOne(LOGIN);
      expect(first.cancelled).toBeTrue();
      second.flush(otpBranch(PROOF_B, 'user-2'));
      fixture.detectChanges();
      // The first answer, arriving last, must not replace the second attempt.
      deliverIfLive(first, otpBranch(PROOF_A, 'user-1'));
      expect(heldProof()).toBe(PROOF_B);
      expect(component.log_in.profile.id).toBe('user-2');
    });

    it('CONSTRUCTED: Back while a code is verified cancels it, and the next sign-in is not given the old tokens', async () => {
      // Back is disabled while verifying, so this is reached only by calling the method.
      reachOtpScreen(PROOF_A, 'user-1');
      await enterOtp('1234');
      pressVerify();
      const staleVerify = http.expectOne(VERIFY);
      component.backToLogin();
      fixture.detectChanges();
      expect(staleVerify.cancelled).toBeTrue();

      reachOtpScreen(PROOF_B, 'user-2');
      expect(heldProof()).toBe(PROOF_B);
      await enterOtp('5678');
      pressVerify();
      const verify = http.expectOne(VERIFY);
      expect(verify.request.body).toEqual({ user: 'user-2', otp: '5678' });
      // The stale code's answer arrives while the second attempt is on its code screen.
      deliverIfLive(staleVerify, { status: 200, message: 'OTP verified', data: { valid: true, token: 'jwt-A', refresh: 'ref-A' } });
      expect(auth.userValue).withContext('no tokens adopted from the stale code').toBeNull();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(heldProof()).toBe(PROOF_B);
      verify.flush({ status: 200, message: 'OTP verified', data: { valid: true, token: 'jwt-B', refresh: 'ref-B' } });
      expect(auth.userValue?.token).toBe('jwt-B');
      expect(auth.userValue?.profile.id).toBe('user-2');
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/dashboard');
    });
  });
});
