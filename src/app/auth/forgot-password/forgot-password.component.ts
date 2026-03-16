import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from 'src/app/_services/api.service';
import { MessageService } from 'src/app/_services/message.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css']
})
export class ForgotPasswordComponent {
submitted: boolean = false;
@Input() as_diner: boolean = false;
  @Output() LoginResp = new EventEmitter<any>();
  selectedOption: any;
  email: any;
  countryCode: any;
  phoneNumber: any;
  require_otp: boolean = false;
  isSubmittingOtp = false;
  countdown = 30;
  timer: any;
  data = '';
  rateLimited = false;

  constructor(private fb: FormBuilder, private api: ApiService, private router: Router, private messageService: MessageService) {
    this.ForgotPasswordForm = this.fb.group({
      selectedOption: ['', Validators.required],
      email: ['', [Validators.email]],
      phoneNumber: ['', [Validators.pattern(/^\d{9}$/)]],
    }, { validator: this.requireContactMethod.bind(this) });
  }
  ForgotPasswordForm!: FormGroup;

  requireContactMethod(group: FormGroup) {
    const selectedOption = group.get('selectedOption')?.value;
    const email = group.get('email')?.value;
    const phoneNumber = group.get('phoneNumber')?.value;

    if ((selectedOption === 'email' && !email) || (selectedOption === 'phone' && !phoneNumber)) {
      return { contactMethodRequired: true };
    }
    return null;
  }

  /** Get the identifier value based on the selected contact method */
  private getIdentifier(): string {
    if (this.ForgotPasswordForm.get('selectedOption')?.value === 'email') {
      return this.ForgotPasswordForm.get('email')?.value;
    }
    return '256' + this.replaceLeadingZero(this.ForgotPasswordForm.get('phoneNumber')?.value, '0');
  }

  replaceLeadingZero(phoneNumber: any, replacementString: any) {
    if (phoneNumber.startsWith('0')) {
      return replacementString + phoneNumber.slice(1);
    }
    return phoneNumber;
  }

  /**
   * Step 1: Initiate password reset — sends OTP to user
   * New backend contract: POST /users/auth/initiate-reset-password/
   */
  ResetPassword() {
    this.submitted = true;
    this.rateLimited = false;
    const identifier = this.getIdentifier();
    const identification = this.ForgotPasswordForm.get('selectedOption')?.value;

    this.api.postPatch('users/auth/initiate-reset-password/',
      {
        identifier: identifier,
        identification: identification,
      }, 'post').subscribe({
        next: () => {
          this.startCountdown();
          this.require_otp = true;
          this.submitted = false;
        },
        error: (error: any) => {
          this.submitted = false;
          if (error === 'rate_limited') {
            this.rateLimited = true;
          } else {
            this.messageService.addMessage({ severity: 'error', summary: 'Error', message: error });
          }
        }
    });
  }

  /**
   * Step 2+3: Submit OTP to reset-password endpoint.
   * On success, backend returns { token, temp_password }.
   * Step 4: Route to lock-otp-exp with token + temp_password for change-password.
   */
  Submit() {
    this.submitted = true;
    this.isSubmittingOtp = true;
    this.rateLimited = false;
    const identifier = this.getIdentifier();

    this.api.postPatch('users/auth/reset-password/', {
      phone_number: identifier,
      otp: this.data
    }, 'post').subscribe({
      next: (response: any) => {
        this.isSubmittingOtp = false;
        this.submitted = false;

        // Backend returns token + temp_password for the change-password step
        const token = response?.data?.token || response?.token;
        const tempPassword = response?.data?.temp_password || response?.temp_password;

        if (token && tempPassword) {
          // Route to change-password screen with temporary credentials
          this.router.navigate(['lock-otp-exp'], {
            state: {
              username: identifier,
              oldPassword: tempPassword,
              resetToken: token,
              fullname: ''
            }
          });
        } else {
          // Fallback: if backend doesn't return token/temp_password, just redirect to login
          this.messageService.addMessage({ severity: 'info', summary: 'Success', message: response?.message || 'Password reset successful. Please login.' });
          this.data = '';
          this.require_otp = false;
          setTimeout(() => {
            this.router.navigate(['/login']);
          }, 1500);
        }
      },
      error: (error: any) => {
        this.isSubmittingOtp = false;
        this.submitted = false;
        if (error === 'rate_limited') {
          this.rateLimited = true;
        } else {
          this.messageService.addMessage({ severity: 'error', summary: 'Error', message: error });
        }
        this.data = '';
        this.require_otp = false;
      }
    });
  }

  resendOTP() {
    this.countdown = 30;
    this.startCountdown();
    this.ResetPassword();
  }

  startCountdown(): void {
    this.timer = setInterval(() => {
      if (this.countdown > 0) {
        this.countdown--;
      } else {
        clearInterval(this.timer);
      }
    }, 1000);
  }
}
