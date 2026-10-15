/**
 * SIGN-UP: A NUMBER WITH NO ACCOUNT IS ANSWERED WITH AN HTTP 404, AND THAT
 * ANSWER MUST START THE OTP STEP.
 *
 * `RegisterComponent.Register()` asks `GET users/msisdn-lookup/` whether the
 * typed number already has an account. The backend's `MsisdnLookupEndpoint`
 * (`users_app/endpoints/user_lookup.py`) has answered, since `a2f7f8c`
 * (2026-03-16, "normalize HTTP status codes"):
 *
 *   found      HTTP 200  {status: 200, message: 'User found',     data: {found: true}}
 *   not found  HTTP 404  {status: 404, message: 'User not found', data: {found: false}}
 *
 * Before `a2f7f8c` the not-found answer was HTTP 200 with `status: 400` in the
 * BODY, and that is the shape the component was written against: it sent the
 * OTP only from its `next` callback when `x.status == 400`. An HTTP 404 never
 * reaches `next` — `HttpClient` delivers it to `error`, the subscription had
 * no error callback, and `ErrorInterceptor` flattened it into a "User not found"
 * toast. So a brand-new number got a toast and no OTP, and could not sign up.
 *
 * EVERYTHING HERE RUNS THE REAL CHAIN exactly as `app.module.ts` registers it —
 * `AuthInterceptor` → `DinerSessionInterceptor` → `ErrorInterceptor`, class
 * based, `withXhr()` + `withInterceptorsFromDi()` — over the real
 * `AuthenticationService`, `ApiService` and `ToastService`, and the form is
 * driven through its rendered DOM: the details are typed, the terms box is
 * ticked and "Create an account" is clicked. Server answers are SYNTHETIC; their
 * bodies are the ones the endpoints above write.
 *
 * THIS FILE IMPORTS NOTHING THE FIX ADDED, so the same file compiles against
 * the unmodified baseline. Specs marked REGRESSION fail there; specs marked
 * CONTROL pass before and after.
 *
 * UNHANDLED ERRORS ARE CAPTURED, NOT LEFT TO ESCAPE. A subscription with no
 * error callback hands its error to RxJS, which rethrows it from a later
 * `setTimeout` — into whichever spec happens to be running then. This file
 * routes those errors through `config.onUnhandledError` and drains the queue
 * before each spec ends, so a spec can assert that none occurred.
 *
 * `RegisterUser()` FAILURES ARE PINNED HERE TOO, on the same harness. It had no
 * error callback, so every refused registration reached RxJS as unhandled: the
 * interceptor's toast was right and the error still escaped. Those specs drive
 * the existing-number path through the DOM. The OTP path is driven by calling
 * `Register()`, the method the Verify button is meant to reach. The template's
 * submit condition requires the phone input, which the OTP step removes, so
 * the button does not reach it today. That is a separate defect, left alone
 * here.
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
import { RouterLink, provideRouter } from '@angular/router';
import { config } from 'rxjs';

import { environment } from 'src/environments/environment';
import { AuthInterceptor } from 'src/app/_helpers/auth.interceptor';
import { DinerSessionInterceptor } from 'src/app/_helpers/diner-session.interceptor';
import { ErrorInterceptor } from 'src/app/_helpers/error.interceptor';
import { ConnectivityService } from 'src/app/_services/connectivity.service';
import { WINDOW } from 'src/app/_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from 'src/app/_services/storage/storage-key-prefix.token';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { DinifyCommonModule } from 'src/app/_common/dinify-common.module';
import { DinifyPhoneInputComponent } from 'src/app/shared/dinify-phone-input/dinify-phone-input.component';
import { RegisterComponent } from './register.component';

const API = `${environment.apiUrl}/api/${environment.version}`;
const MSISDN = '256700111222';
const LOOKUP = `${API}/users/msisdn-lookup/?msisdn=${MSISDN}`;
const RESEND_OTP = `${API}/users/auth/resend-otp/`;
const REGISTER = `${API}/users/auth/register/`;

// The bodies `MsisdnLookupEndpoint` writes.
const NOT_FOUND = { status: 404, message: 'User not found', data: { found: false } };
const FOUND = { status: 200, message: 'User found', data: { found: true } };
// What `register` answers for a number that already has an account (backend #366).
const PHONE_EXISTS = {
  status: 400,
  message: 'Sorry, a user with this phone number already exists!',
};
// What `register` answers when the OTP does not verify (`self_register`).
const INVALID_OTP = { status: 400, message: 'Invalid OTP.' };

const OFFLINE = "You're offline — check your connection.";

describe('Sign-up: the msisdn lookup through the real interceptor chain', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;
  let http: HttpTestingController;
  let toast: ToastService;
  let unhandled: unknown[];
  let previousOnUnhandled: typeof config.onUnhandledError;

  /** Let RxJS's deferred unhandled-error report run before asserting on it. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    unhandled = [];
    previousOnUnhandled = config.onUnhandledError;
    config.onUnhandledError = (err) => unhandled.push(err);

    await TestBed.configureTestingModule({
      declarations: [RegisterComponent],
      imports: [
        ReactiveFormsModule,
        FormsModule,
        DinifyCommonModule,
        DinifyPhoneInputComponent,
        RouterLink,
      ],
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
    spyOn(toast, 'error').and.callThrough();
    spyOn(toast, 'warning').and.callThrough();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(async () => {
    await settle();
    config.onUnhandledError = previousOnUnhandled;
    http.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  function type(selector: string, value: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function buttonLabelled(label: string): HTMLButtonElement {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const button = buttons.find((b) => b.textContent?.trim() === label);
    if (!button) throw new Error(`no button labelled "${label}"`);
    return button;
  }

  /** Fill every field as a person would, then press "Create an account". */
  function fillAndSubmit(): void {
    type('#first_name', 'Amara');
    type('#last_name', 'Okello');
    type('#phone', '0700111222');
    type('#password', 'Secret#123');
    type('#confirm-password', 'Secret#123');
    (fixture.nativeElement.querySelector('#terms') as HTMLInputElement).click();
    fixture.detectChanges();

    // PREMISE: the form the template gates `Register()` on is really valid, and
    // the phone field emitted the canonical MSISDN. Without this a failure below
    // could mean "the fixture never submitted" rather than anything about the
    // lookup.
    expect(component.RegisterForm.valid).withContext('form valid').toBeTrue();
    expect(component.phoneComponent?.isValid).withContext('phone valid').toBeTrue();
    expect(component.RegisterForm.get('phone_number')?.value).toBe(MSISDN);

    buttonLabelled('Create an account').click();
  }

  function answerLookup(body: object, status: number, statusText: string): void {
    const lookup = http.expectOne(LOOKUP);
    expect(lookup.request.method).toBe('GET');
    lookup.flush(body, { status, statusText });
  }

  it('REGRESSION: a number with no account (HTTP 404) requests the OTP and opens the OTP step', async () => {
    fillAndSubmit();
    answerLookup(NOT_FOUND, 404, 'Not Found');

    const otp = http.match(RESEND_OTP);
    expect(otp.length).withContext('an OTP was requested for the new number').toBe(1);
    if (otp.length === 1) {
      expect(otp[0].request.method).toBe('POST');
      expect(otp[0].request.body).toEqual({
        identification: 'msisdn',
        identifier: MSISDN,
        purpose: null,
      });
      otp[0].flush({ status: 200, message: 'OTP sent' });
    }
    fixture.detectChanges();

    expect(component.require_otp).withContext('OTP step open').toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('We have sent the OTP to your phone');
    // Nothing is registered before the OTP is entered.
    expect(http.match(REGISTER).length).toBe(0);
  });

  it('REGRESSION: the 404 is not ALSO reported as a "User not found" failure', async () => {
    fillAndSubmit();
    answerLookup(NOT_FOUND, 404, 'Not Found');
    http.match(RESEND_OTP).forEach((r) => r.flush({ status: 200, message: 'OTP sent' }));
    await settle();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.toasts).toEqual([]);
    expect(unhandled).withContext('the lookup error reached no handler').toEqual([]);
  });

  it('CONTROL: a number that already has an account goes straight to register, with no OTP', () => {
    fillAndSubmit();
    answerLookup(FOUND, 200, 'OK');

    expect(http.match(RESEND_OTP).length).toBe(0);
    const register = http.expectOne(REGISTER);
    expect(register.request.method).toBe('POST');
    expect(register.request.body).toEqual(jasmine.objectContaining({
      first_name: 'Amara',
      last_name: 'Okello',
      phone_number: MSISDN,
      country: 'UG',
      ok: true,
    }));

    // The backend refuses it (backend #366); the refusal is surfaced as before.
    register.flush(PHONE_EXISTS, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(toast.error).toHaveBeenCalledWith(PHONE_EXISTS.message);
    expect(component.require_otp).toBeFalse();
    expect(http.match(RESEND_OTP).length).toBe(0);
  });

  it('CONTROL: a server failure is not "no account" — no OTP, the server message is shown', () => {
    fillAndSubmit();
    answerLookup(
      { status: 500, message: 'Something went wrong' },
      500,
      'Internal Server Error',
    );

    expect(http.match(RESEND_OTP).length).toBe(0);
    expect(http.match(REGISTER).length).toBe(0);
    expect(component.require_otp).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('Something went wrong');
  });

  it('CONTROL: a network failure is not "no account" — no OTP, the offline toast is shown', () => {
    fillAndSubmit();
    http.expectOne(LOOKUP).error(new ProgressEvent('error'), {
      status: 0,
      statusText: 'Unknown Error',
    });

    expect(http.match(RESEND_OTP).length).toBe(0);
    expect(component.require_otp).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith(OFFLINE);
  });

  it('CONTROL: rate limiting is not "no account" — no OTP, the rate-limit warning is shown', () => {
    fillAndSubmit();
    answerLookup(
      { status: 429, message: 'Too many attempts.' },
      429,
      'Too Many Requests',
    );

    expect(http.match(RESEND_OTP).length).toBe(0);
    expect(component.require_otp).toBeFalse();
    expect(toast.warning).toHaveBeenCalledWith('Too many attempts.');
  });

  it('CONTROL: a 404 that is not the lookup\'s own answer is not "no account"', () => {
    // A 404 with no `{status: 404}` envelope is not MsisdnLookupEndpoint saying
    // "no such user" — it is a missing route or a proxy's page. Sending an OTP
    // on it would claim something the server never said.
    fillAndSubmit();
    answerLookup({ detail: 'Not found.' }, 404, 'Not Found');

    expect(http.match(RESEND_OTP).length).toBe(0);
    expect(component.require_otp).toBeFalse();
    expect(toast.error).toHaveBeenCalled();
  });

  describe('RegisterUser failures', () => {
    let saved: unknown[];

    beforeEach(() => {
      saved = [];
      component.saved.subscribe((x) => saved.push(x));
    });

    /** The existing-number path: the lookup finds the number, then `register`. */
    function registerExistingNumber() {
      fillAndSubmit();
      answerLookup(FOUND, 200, 'OK');
      return http.expectOne(REGISTER);
    }

    /**
     * The OTP path: no account, OTP sent, four digits typed into the real OTP
     * input, then `Register()` (see the file header for why it is called
     * directly rather than through the Verify button). The OTP input publishes
     * its value from a `setTimeout`, hence the `settle()` after typing.
     */
    async function registerWithOtp(code: string): Promise<TestRequest> {
      if (!component.require_otp) {
        fillAndSubmit();
        answerLookup(NOT_FOUND, 404, 'Not Found');
        http.expectOne(RESEND_OTP).flush({ status: 200, message: 'OTP sent' });
        fixture.detectChanges();
        // Let ngModel's initial (empty) write land before typing, as it does
        // for a person; typed earlier, it would clear the boxes.
        await settle();
        fixture.detectChanges();
      }
      const boxes = Array.from(
        fixture.nativeElement.querySelectorAll('app-otp-input input'),
      ) as HTMLInputElement[];
      expect(boxes.length).withContext('OTP boxes rendered').toBe(4);
      code.split('').forEach((digit, i) => {
        boxes[i].value = digit;
        boxes[i].dispatchEvent(new Event('input'));
      });
      await settle();
      fixture.detectChanges();
      expect(component.data).withContext('OTP entered').toBe(code);

      component.Register();
      const register = http.expectOne(REGISTER);
      expect(register.request.body).toEqual(jasmine.objectContaining({ otp: code }));
      return register;
    }

    it('REGRESSION: a refused registration is handled — shown once, nothing escapes, the form is kept', async () => {
      registerExistingNumber().flush(PHONE_EXISTS, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();
      await settle();

      expect(unhandled).withContext('the refusal reached no handler').toEqual([]);
      expect(toast.toasts.map((t) => t.message)).toEqual([PHONE_EXISTS.message]);
      expect(component.RegisterForm.get('first_name')?.value).toBe('Amara');
      expect(component.RegisterForm.get('phone_number')?.value).toBe(MSISDN);
      expect(saved).toEqual([]);
    });

    it('REGRESSION: a wrong OTP is handled, stays on the OTP step, and the person can try again', async () => {
      (await registerWithOtp('1234')).flush(INVALID_OTP, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();
      await settle();

      expect(unhandled).withContext('the refusal reached no handler').toEqual([]);
      expect(toast.toasts.map((t) => t.message)).toEqual([INVALID_OTP.message]);
      expect(component.require_otp).withContext('still on the OTP step').toBeTrue();
      expect(saved).toEqual([]);

      // A corrected code goes out as a fresh request and completes.
      (await registerWithOtp('5678')).flush({ status: 200, message: 'Registration successful' });
      expect(saved.length).toBe(1);
    });

    it('REGRESSION: a network failure on register is handled — the offline toast, nothing escapes', async () => {
      registerExistingNumber().error(new ProgressEvent('error'), {
        status: 0,
        statusText: 'Unknown Error',
      });
      await settle();

      expect(unhandled).withContext('the failure reached no handler').toEqual([]);
      expect(toast.error).toHaveBeenCalledWith(OFFLINE);
      expect(component.RegisterForm.get('first_name')?.value).toBe('Amara');
      expect(saved).toEqual([]);
    });

    it('REGRESSION: a server failure on register is handled — the server message, nothing escapes', async () => {
      registerExistingNumber().flush(
        { status: 500, message: 'Something went wrong' },
        { status: 500, statusText: 'Internal Server Error' },
      );
      await settle();

      expect(unhandled).withContext('the failure reached no handler').toEqual([]);
      expect(toast.error).toHaveBeenCalledWith('Something went wrong');
      expect(saved).toEqual([]);
    });

    it('CONTROL: a successful registration still toasts, resets the form and emits saved', async () => {
      const response = { status: 200, message: 'Registration successful' };
      (await registerWithOtp('1234')).flush(response);
      await settle();

      expect(unhandled).toEqual([]);
      expect(toast.toasts.map((t) => t.message)).toEqual([response.message]);
      expect(component.RegisterForm.get('first_name')?.value).toBe('');
      expect(component.data).toBe('');
      expect(saved).toEqual([response]);
    });
  });
});
