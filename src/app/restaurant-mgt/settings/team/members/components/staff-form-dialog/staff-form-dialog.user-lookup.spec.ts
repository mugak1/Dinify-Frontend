/**
 * ADD STAFF: A CONTACT WITH NO ACCOUNT IS ANSWERED WITH AN HTTP 404, AND THAT
 * ANSWER MUST OPEN THE NEW-EMPLOYEE FORM.
 *
 * `StaffFormDialogComponent.lookUp()` asks `GET users/user-lookup/` whether the
 * typed number already has a Dinify account. The backend's `UserLookupEndpoint`
 * (`users_app/endpoints/user_lookup.py`) answers an owner with:
 *
 *   found      HTTP 200  {status: 200, message: 'User found', data: {id, first_name, last_name}}
 *   not found  HTTP 404  {status: 404, message: 'User not found'}
 *   no contact HTTP 400  {status: 400, message: 'A contact query parameter is required.'}
 *   bad number HTTP 400  {status: 400, message: 'Please provide a valid Ugandan phone number.'}
 *   not owner  HTTP 403  {status: 403, message: 'Not authorised.'}
 *
 * The not-found answer has been an HTTP 404 since `a2f7f8c` (2026-03-16); before
 * that it was HTTP 200 with `status: 400` in the BODY, which is the shape
 * `lookUp()` read in its `next` callback. An HTTP 404 goes to `error` instead,
 * where it was reported as "Could not look up that number" — so an owner could
 * never reach the create-new-employee path (`restaurant-setup/create-employee/`,
 * the one route that issues the one-time temp password).
 *
 * The existing `staff-form-dialog.component.spec.ts` could not see this: it
 * stubs `ApiService` with `of({status: 400})`, a shape no deployed server has
 * produced since `a2f7f8c`. Here everything runs the REAL chain exactly as
 * `app.module.ts` registers it — `AuthInterceptor` → `DinerSessionInterceptor`
 * → `ErrorInterceptor`, `withXhr()` + `withInterceptorsFromDi()` — over the real
 * `AuthenticationService` (an owner seeded into storage), `ApiService` and
 * `ToastService`, and the dialog is driven through its rendered DOM. Server
 * answers are SYNTHETIC; their bodies are the ones the endpoint above writes.
 *
 * A 400 WITH THE LOOKUP'S OWN ENVELOPE IS THE SERVER EXPLAINING WHY IT WILL NOT
 * LOOK THE CONTACT UP, so the dialog shows that explanation. It used to replace
 * it with "Could not look up that number. Please try again.", and "try again"
 * is wrong for a number that is simply not a valid Ugandan number: the backend
 * answers that with a 400 since it began canonicalising the contact. A 403, a
 * server or network failure, and a 400 without the envelope still get the
 * dialog's own message.
 *
 * THIS FILE IMPORTS NOTHING THE FIX ADDED, so the same file compiles against
 * the unmodified baseline. Specs marked REGRESSION fail there; specs marked
 * CONTROL pass before and after.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  provideHttpClient,
  withInterceptorsFromDi,
  withXhr,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { environment } from 'src/environments/environment';
import { AuthInterceptor } from 'src/app/_helpers/auth.interceptor';
import { DinerSessionInterceptor } from 'src/app/_helpers/diner-session.interceptor';
import { ErrorInterceptor } from 'src/app/_helpers/error.interceptor';
import { CreateEmployeeResponse } from 'src/app/_models/app.models';
import { ConnectivityService } from 'src/app/_services/connectivity.service';
import { WINDOW } from 'src/app/_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from 'src/app/_services/storage/storage-key-prefix.token';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { StaffFormDialogComponent } from './staff-form-dialog.component';

const API = `${environment.apiUrl}/api/${environment.version}`;
const MSISDN = '256700111222';
const LOOKUP = `${API}/users/user-lookup/?contact=${MSISDN}`;
const CREATE_EMPLOYEE = `${API}/restaurant-setup/create-employee/`;
const ASSIGN = `${API}/restaurant-setup/employees/`;

const OWNER_TOKEN = 'owner-access-token';
const OWNER = {
  token: OWNER_TOKEN,
  refresh: 'owner-refresh-token',
  profile: {
    id: 'owner-1', first_name: 'O', last_name: 'Wner', email: '', roles: [],
    phone_number: '', country: 'UG', prompt_password_change: false, other_names: '',
    restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] }],
  },
  require_otp: false,
  prompt_password_change: false,
};

// The bodies `UserLookupEndpoint` writes.
const NOT_FOUND = { status: 404, message: 'User not found' };
const FOUND = {
  status: 200,
  message: 'User found',
  data: { id: 'existing-user', first_name: 'Jane', last_name: 'Doe' },
};

const COULD_NOT_LOOK_UP = 'Could not look up that number. Please try again.';
const INVALID_NUMBER = { status: 400, message: 'Please provide a valid Ugandan phone number.' };
const NEW_MEMBER_SUBTITLE = 'Add the new team member’s details.';

describe('Add staff: the user lookup through the real interceptor chain', () => {
  let fixture: ComponentFixture<StaffFormDialogComponent>;
  let component: StaffFormDialogComponent;
  let http: HttpTestingController;
  let toast: ToastService;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('user', JSON.stringify(OWNER));
    localStorage.setItem(
      'rest_role',
      JSON.stringify({ restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] }),
    );

    await TestBed.configureTestingModule({
      imports: [StaffFormDialogComponent],
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

    fixture = TestBed.createComponent(StaffFormDialogComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('restaurant', 'r1');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
    sessionStorage.clear();
  });

  const $ = (selector: string) => fixture.nativeElement.querySelector(selector);

  function type(selector: string, value: string): void {
    const el = $(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function choose(selector: string, value: string): void {
    const el = $(selector) as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change'));
  }

  function press(label: string): void {
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    const button = buttons.find((b) => b.textContent?.trim() === label);
    if (!button) throw new Error(`no button labelled "${label}"`);
    button.click();
    fixture.detectChanges();
  }

  /** Type the number and press Next; answer the lookup the server's way. */
  function lookUp(body: object, status: number, statusText: string): void {
    type('#phone', '0700111222');
    fixture.detectChanges();
    expect(component.RegisterForm.get('phone_number')?.value).toBe(MSISDN);
    press('Next');

    const lookup = http.expectOne(LOOKUP);
    expect(lookup.request.method).toBe('GET');
    // CONTROL that the deployed chain ran: AuthInterceptor attached the owner's token.
    expect(lookup.request.headers.get('Authorization')).toBe(`Bearer ${OWNER_TOKEN}`);
    lookup.flush(body, { status, statusText });
    fixture.detectChanges();
  }

  function visibleToasts(): string[] {
    return toast.toasts.map((t) => t.message);
  }

  it('REGRESSION: a contact with no account (HTTP 404) opens the new-employee form', () => {
    lookUp(NOT_FOUND, 404, 'Not Found');

    expect(component.checked).withContext('checked').toBeTrue();
    expect(component.user_id).toBeNull();
    expect(component.saving).toBeFalse();
    expect($('#staff-first')).withContext('first name field').not.toBeNull();
    expect($('#staff-last')).withContext('last name field').not.toBeNull();
    expect($('#staff-email')).withContext('email field').not.toBeNull();
    expect($('#staff-add-role')).withContext('role picker').not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(NEW_MEMBER_SUBTITLE);
  });

  it('REGRESSION: the 404 raises no toast at all — neither "User not found" nor a lookup failure', () => {
    lookUp(NOT_FOUND, 404, 'Not Found');

    expect(toast.error).not.toHaveBeenCalled();
    expect(visibleToasts()).toEqual([]);
  });

  it('REGRESSION: the owner can then create the new employee and is handed the temp password', () => {
    let created: CreateEmployeeResponse | null = null;
    let saved = false;
    component.created.subscribe((r) => (created = r));
    component.saved.subscribe(() => (saved = true));

    lookUp(NOT_FOUND, 404, 'Not Found');
    // If the new-employee step never opened there is nothing to fill in.
    if (!$('#staff-first')) {
      fail('the new-employee form never opened');
      return;
    }
    type('#staff-first', 'New');
    type('#staff-last', 'Hire');
    choose('#staff-add-role', 'kitchen');
    press('Save');

    const create = http.expectOne(CREATE_EMPLOYEE);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(jasmine.objectContaining({
      first_name: 'New',
      last_name: 'Hire',
      phone_number: MSISDN,
      roles: ['kitchen'],
      restaurant: 'r1',
    }));
    create.flush({ status: 200, message: 'Employee created', data: { temp_password: 'TMP-123' } });

    expect(created).not.toBeNull();
    expect(created!.data?.temp_password).toBe('TMP-123');
    expect(saved).toBeFalse();
    expect(http.match(ASSIGN).length).toBe(0);
  });

  it('CONTROL: a contact that already has an account reveals the role-only step and assigns', () => {
    let saved = false;
    component.saved.subscribe(() => (saved = true));

    lookUp(FOUND, 200, 'OK');

    expect(component.checked).toBeTrue();
    expect(component.user_id).toBe('existing-user');
    expect($('#staff-first')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('This person already has a Dinify account.');

    choose('#staff-add-role', 'restaurant_staff');
    press('Save');
    const assign = http.expectOne(ASSIGN);
    expect(assign.request.method).toBe('POST');
    expect(assign.request.body).toEqual({
      user: 'existing-user',
      restaurant: 'r1',
      roles: ['restaurant_staff'],
    });
    assign.flush({ status: 200, message: 'Employee added' });
    expect(saved).toBeTrue();
    expect(http.match(CREATE_EMPLOYEE).length).toBe(0);
  });

  /** Not "no account": the dialog stays on the lookup step with one toast. */
  function expectLookupFailed(message = COULD_NOT_LOOK_UP): void {
    expect(component.checked).withContext('checked').toBeFalse();
    expect(component.user_id).toBeNull();
    expect(component.saving).toBeFalse();
    expect($('#staff-first')).toBeNull();
    expect(visibleToasts()).toEqual([message]);
  }

  it('REGRESSION: a number the lookup refuses shows the server\'s reason, not "try again"', () => {
    lookUp(INVALID_NUMBER, 400, 'Bad Request');
    expectLookupFailed(INVALID_NUMBER.message);
  });

  it('CONTROL: a 403 (not an owner) is a lookup failure, not "no account"', () => {
    lookUp({ status: 403, message: 'Not authorised.' }, 403, 'Forbidden');
    expectLookupFailed();
    // The interceptor still surfaced the denial first; the dialog replaced it.
    expect(toast.error).toHaveBeenCalledWith('Not authorised.');
  });

  it('CONTROL: a server failure is a lookup failure, not "no account"', () => {
    lookUp({ status: 500, message: 'Something went wrong' }, 500, 'Internal Server Error');
    expectLookupFailed();
  });

  it('CONTROL: a network failure is a lookup failure, not "no account"', () => {
    type('#phone', '0700111222');
    fixture.detectChanges();
    press('Next');
    http.expectOne(LOOKUP).error(new ProgressEvent('error'), {
      status: 0,
      statusText: 'Unknown Error',
    });
    fixture.detectChanges();
    expectLookupFailed();
  });

  it('REGRESSION: the lookup\'s own 400 is not "no account", and its message is shown', () => {
    // The endpoint's own 400 means the request named no contact. It used to be
    // the BODY status of the not-found answer, which is why it is pinned here.
    // The "not no account" half is unchanged. The toast half was corrected: this
    // spec used to expect "Could not look up that number", and the server's own
    // reason replaces it, as for the invalid-number refusal above.
    lookUp(
      { status: 400, message: 'A contact query parameter is required.' },
      400,
      'Bad Request',
    );
    expectLookupFailed('A contact query parameter is required.');
  });

  it('CONTROL: a 400 without the lookup\'s envelope keeps the dialog\'s own message', () => {
    // No `{status: 400}` body: not UserLookupEndpoint explaining itself, so
    // there is no reason of the server's to show.
    lookUp({ detail: 'Bad request.' }, 400, 'Bad Request');
    expectLookupFailed();
  });

  it('CONTROL: a 404 that is not the lookup\'s own answer is a lookup failure, not "no account"', () => {
    // No `{status: 404}` envelope: a missing route or a proxy's page, not
    // UserLookupEndpoint saying "no such user". Opening the new-employee form on
    // it would invite a second account for a number that may already have one.
    lookUp({ detail: 'Not found.' }, 404, 'Not Found');
    expectLookupFailed();
  });
});
