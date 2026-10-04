import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ForgotPasswordComponent } from './forgot-password.component';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { OtpInputComponent } from 'src/app/_common/otp-input/otp-input.component';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';

/**
 * D11 E-R1: the reset screens must not claim that a code was sent.
 *
 * The Backend acknowledges a reset request identically whether or not the details match
 * an eligible account, so "We sent a one-time code to your phone" would be false for
 * every request that matched nobody. The copy is conditional, and it is the same for
 * both identifier methods, because the screen cannot know which channel the server used.
 * The component's logic is unchanged: it ignores the initiation body, toasts an error
 * and navigates on a completed reset exactly as before.
 */
const INTRO = 'Enter your email address or phone number to request a reset code.';
const ACK = 'If these details match an eligible account, check its registered phone or email for a reset code.';
const RETIRED = [
  'We sent a one-time code to your email.',
  'We sent a one-time code to your phone.',
  "Enter your email or phone and we'll send a reset code.",
];

describe('ForgotPasswordComponent', () => {
  let component: ForgotPasswordComponent;
  let fixture: ComponentFixture<ForgotPasswordComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;

  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ').trim();

  const choose = (method: 'email' | 'phone'): void => {
    component.ForgotPasswordForm.get('selectedOption')!.setValue(method);
    if (method === 'email') {
      component.ForgotPasswordForm.get('email')!.setValue('diner@example.com');
    } else {
      component.ForgotPasswordForm.get('phoneNumber')!.setValue('772000101');
    }
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['postPatch']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    await TestBed.configureTestingModule({
      declarations: [ForgotPasswordComponent, OtpInputComponent],
      imports: [ReactiveFormsModule, FormsModule, AuthShellComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
      ],
      // routerLink on "Back to sign in" is not under test
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => clearInterval(component.timer));

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('introduces the request without promising that a code will be sent', () => {
    expect(text()).toContain(INTRO);
    RETIRED.forEach(old => expect(text()).not.toContain(old));
  });

  for (const method of ['phone', 'email'] as const) {
    it(`shows the conditional acknowledgement after a ${method} request`, () => {
      api.postPatch.and.returnValue(of({ status: 200, message: ACK }));
      choose(method);
      component.ResetPassword();
      fixture.detectChanges();

      expect(component.require_otp).toBeTrue();
      expect(text()).toContain(ACK);
      RETIRED.forEach(old => expect(text()).not.toContain(old));
    });
  }

  it('sends the same request it always did, and ignores the success body', () => {
    // No user_id, no data at all: the screen advances on any success.
    api.postPatch.and.returnValue(of({}));
    choose('phone');
    component.ResetPassword();

    expect(api.postPatch).toHaveBeenCalledOnceWith(
      'users/auth/initiate-reset-password/',
      { identifier: '256772000101', identification: 'phone' }, 'post');
    expect(component.require_otp).toBeTrue();
  });

  it('keeps showing an initiation error as before, and does not advance', () => {
    api.postPatch.and.returnValue(throwError(() => "We couldn't send your verification code. Please try again."));
    choose('phone');
    component.ResetPassword();
    fixture.detectChanges();

    expect(toast.error).toHaveBeenCalledWith("We couldn't send your verification code. Please try again.");
    expect(component.require_otp).toBeFalse();
    expect(text()).toContain(INTRO);
    expect(text()).not.toContain(ACK);
  });

  it('keeps the rate-limit notice instead of a toast', () => {
    api.postPatch.and.returnValue(throwError(() => 'rate_limited'));
    choose('email');
    component.ResetPassword();
    fixture.detectChanges();

    expect(component.rateLimited).toBeTrue();
    expect(toast.error).not.toHaveBeenCalled();
    expect(text()).toContain('Too many attempts.');
  });

  it('resend repeats the initiation request and keeps the conditional wording', () => {
    api.postPatch.and.returnValue(of({}));
    choose('email');
    component.ResetPassword();
    component.resendOTP();
    fixture.detectChanges();

    expect(api.postPatch).toHaveBeenCalledTimes(2);
    expect(api.postPatch.calls.mostRecent().args).toEqual([
      'users/auth/initiate-reset-password/',
      { identifier: 'diner@example.com', identification: 'email' }, 'post']);
    expect(text()).toContain(ACK);
  });

  it('a completed reset still navigates to the change-password step', () => {
    api.postPatch.and.returnValue(of({}));
    choose('phone');
    component.ResetPassword();
    api.postPatch.and.returnValue(of({
      status: 200,
      data: { token: 'access', refresh: 'refresh', temp_password: 'temp', prompt_password_change: true },
    }));
    component.data = '1234';
    component.Submit();

    expect(api.postPatch.calls.mostRecent().args).toEqual([
      'users/auth/reset-password/', { identifier: '256772000101', otp: '1234' }, 'post']);
    expect(router.navigate).toHaveBeenCalledWith(['lock-otp-exp'], {
      state: { username: '256772000101', oldPassword: 'temp', resetToken: 'access', fullname: '' },
    });
  });

  it('an invalid code is still shown as an error and returns to the first step', () => {
    api.postPatch.and.returnValue(of({}));
    choose('phone');
    component.ResetPassword();
    api.postPatch.and.returnValue(throwError(() => 'Invalid OTP.'));
    component.data = '0000';
    component.Submit();
    fixture.detectChanges();

    expect(toast.error).toHaveBeenCalledWith('Invalid OTP.');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(component.require_otp).toBeFalse();
    expect(text()).toContain(INTRO);
  });
});
