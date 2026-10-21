import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { FormGroup, FormBuilder, Validators, NgModel } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { first, Subscription } from 'rxjs';
import { AuthenticationService, LOGIN_RESEND_PROTOCOL, LoginOptions, splitLoginResendProof } from '../../_services/authentication.service';
import { ApiResponse, LoginResponse, OTPResponse, RestaurantRole } from 'src/app/_models/app.models';
import { firstAccessibleRoute } from 'src/app/_helpers/module-access';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrls: ['./login.component.css'],
    standalone: false
})
export class LoginComponent implements OnInit, OnDestroy {
  countdown = 30; // Countdown starts at 30 seconds
  timer: any;
  loginForm!: FormGroup;
  @ViewChild("inputPTO") inputPTO?: NgModel;
  loading = false;
  submitted = false;
  error = '';
  data = '';
  require_otp=false;
  rateLimited=false;
  @Input() as_diner:boolean=false;
  @Output() LoginResp= new EventEmitter<any>();

  log_in!: LoginResponse;
  fieldTextType: boolean=false;

  /**
   * D11 E-R4. The opaque login-resend proof from the CURRENT login attempt, held
   * only here. It is taken out of the login response before `log_in` is set, so
   * it is never part of `log_in`, never persisted, published, logged or put in
   * router state, and it is cleared whenever the attempt it belongs to ends.
   */
  private loginResendProof: string | null = null;
  /**
   * The current login attempt's login, OTP and resend requests. Ending the
   * attempt unsubscribes them together, so an answer to an earlier attempt never
   * reaches its callback: it cannot restore a proof, clear a newer attempt's
   * proof, adopt a stale code's tokens or navigate.
   */
  private attemptWork = new Subscription();

  isSubmittingOtp=false;
  attempt: number=0;

showRestaurantSelector = false;
showLoginForm = true; // default state
availableRestaurants: any[] = [];
selectedRestaurant: any = null;
inactivityNotice = false;
capsLockOn = false;

  constructor(
      private formBuilder: FormBuilder,
      private route: ActivatedRoute,
      private router: Router,
      private authenticationService: AuthenticationService,
      private toast:ToastService
  ) {}

  ngOnInit() {
      this.loginForm = this.formBuilder.group({
          username: ['', Validators.required],
          password: ['', Validators.required]
      });
      this.inactivityNotice = this.route.snapshot.queryParams['reason'] === 'inactivity';
  }

  ngOnDestroy(): void {
    if (this.timer) { clearInterval(this.timer); }
    this.endLoginAttempt();
  }

  /**
   * Ends the current login attempt: forgets its proof and unsubscribes its
   * pending login, OTP and resend requests. Unsubscribing does not prove the
   * server did not act on a request that was already sent; it only stops this
   * screen acting on the answer.
   */
  private endLoginAttempt(): void {
    this.loginResendProof = null;
    this.attemptWork.unsubscribe();
    this.attemptWork = new Subscription();
  }

  // convenience getter for easy access to form fields
  get f() { return this.loginForm.controls; }

  onSubmit() {
    this.endLoginAttempt();
    this.attempt=0;
    this.rateLimited=false;
    this.authenticationService.resetStorage();
      this.submitted = true;
this.loading=true;
this.isSubmittingOtp=(this.data)?true:false;
      // stop here if form is invalid
      if (this.loginForm.invalid) {
        this.loading=false;
          return;
      }

      this.loading = true;
      // Only the restaurant login asks for a login-resend proof. The diner login
      // sends the body it always sent.
      const options: LoginOptions | undefined = this.as_diner ? undefined : { loginResendProtocol: LOGIN_RESEND_PROTOCOL };
      this.attemptWork.add(this.authenticationService.login(this.f['username'].value, this.f['password'].value,this.as_diner?'diner':null, options)
          .pipe(first())
          .subscribe({
              next: (val:ApiResponse<LoginResponse>) => {
                this.loading = false;
                const { session, proof } = splitLoginResendProof(val.data as unknown as LoginResponse);
                this.log_in= session
                if(!this.as_diner){
               if(this.log_in.prompt_password_change){
                this.loginResendProof = null;
                this.router.navigate(["lock-otp-exp"], {
                  state: {
                    username: this.f['username'].value,
                    oldPassword: this.f['password'].value,
                    fullname: `${this.log_in.profile.first_name} ${this.log_in.profile.last_name}`
                  }
                })
               }else  if (this.log_in.require_otp){
this.loginResendProof = proof;
this.require_otp=true;
this.startCountdown();

                }else{
                  // No OTP required and no password change needed — navigate directly
                  if (this.log_in.profile.restaurant_roles.length === 1) {
                    const membership = this.log_in.profile.restaurant_roles[0];
                    this.authenticationService.setCurrentRestaurantRole(membership);
                    this.router.navigateByUrl(this.landingPathForMembership(membership));
                  } else if (this.log_in.profile.restaurant_roles.length > 1) {
                    this.showLoginForm = false;
                    this.showRestaurantSelector = true;
                    this.availableRestaurants = this.log_in.profile.restaurant_roles;
                  } else {
                    // Fallback: no roles assigned — send to welcome page
                    this.router.navigateByUrl('/welcome');
                  }
                  this.isSubmittingOtp = false;
                }

              }
              if(this.as_diner){
                this.LoginResp.emit(true);
              }
              },
              error: (error: any) => {
                  this.loading = false;
                  if (error === 'rate_limited') {
                    this.rateLimited = true;
                  } else {
                    this.error = error;
                  }
              }
          }));
  }
get ProfileLetter() {
    return this.showRestaurantSelector?((this.log_in.profile.first_name+' '+this.log_in.profile.last_name).split(" ").map((n:any)=>n[0]).join(".")):'';
}
get user(){
  return this.showRestaurantSelector?((this.log_in.profile.first_name+' '+this.log_in.profile.last_name)):'';
}
  SubmitOTP(){
    this.isSubmittingOtp=(this.data)?true:false;
    // Use profile.id from the in-memory login response (not persisted userValue,
    // since tokens are no longer stored until OTP is verified). The login this
    // code belongs to is captured now, so the answer is applied to that login
    // and never to whatever `log_in` holds when it arrives.
    const login = this.log_in;
    this.attemptWork.add(this.authenticationService.setOtp(login.profile.id,this.data).pipe(first()).subscribe({
        next:(val:ApiResponse<OTPResponse>)=>{
const log_otp=val.data as unknown as OTPResponse;
if(log_otp.valid){
// The attempt is complete, so its proof and any resend still in flight end here.
this.endLoginAttempt();
// Pass the original login response so UpdateUser can merge profile + real tokens
this.authenticationService.UpdateUser(log_otp, login);
                  if (login.profile.restaurant_roles.length === 1) {
  // One restaurant → auto set and redirect
  const membership = login.profile.restaurant_roles[0];
  this.authenticationService.setCurrentRestaurantRole(membership);
  this.router.navigateByUrl(this.landingPathForMembership(membership));

} else if (login.profile.restaurant_roles.length > 1) {
  // Multiple restaurants → switch popup
  this.require_otp = false; // hide OTP popup
  this.showLoginForm = false;            // 🔴 hide login
  this.showRestaurantSelector = true;    // ✅ only show selector
  this.availableRestaurants = login.profile.restaurant_roles;
} else {
  // Fallback: no roles assigned — send to welcome page
  this.router.navigateByUrl('/welcome');
}
                     this.isSubmittingOtp=false;
                    
}else{
  if(this.attempt<3){
    this.attempt++;
    this.error='';
    this.toast.error('The OTP provided is invalid. Please try again.');
    this.data='';
    this.isSubmittingOtp=false;
  }else{
    this.attempt=0;
    this.error='';
    this.endLoginAttempt();
    this.toast.error('You have exceeded the maximum number of attempts. Please try again later.');
  this.isSubmittingOtp=false;
    //this.error='The OTP provided is invalid'
    //this.message.add(this.error)
    this.authenticationService.logout();
    this.authenticationService.resetStorage();
    this.loginForm.reset();
    this.require_otp=false;
    this.isSubmittingOtp=false;
  }
    
}
        },
        error: (error: any) => {
            if (error === 'rate_limited') {
              this.rateLimited = true;
            } else {
              this.error = error;
              this.toast.error(error);
            }
        }
    }))
  }
  onInputChange($event:any){

    this.loginForm.get('username')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
     }
     startCountdown(): void {
      if (this.timer) { clearInterval(this.timer); }
      this.timer = setInterval(() => {
        if (this.countdown > 0) {
          this.countdown--;
        } else {
          clearInterval(this.timer);
        }
      }, 1000); // Decrease the countdown every second
    }
    toggleFieldTextType() {
      this.fieldTextType = !this.fieldTextType
  }
  /**
   * Caps-Lock indicator. Guarded so it only mutates state on a real toggle —
   * avoids the per-keystroke change-detection churn that collided with Android
   * IME composition and capped manual password entry at one character. Soft
   * keyboards may not implement getModifierState; fall back to the current value.
   */
  onPasswordKeyup(event: KeyboardEvent): void {
    const on = typeof event.getModifierState === 'function'
      ? event.getModifierState('CapsLock')
      : this.capsLockOn;
    if (on !== this.capsLockOn) {
      this.capsLockOn = on;
    }
  }
    resendOTP(): void {
      this.countdown = 30; // Reset the countdown
      this.startCountdown();
      // Use in-memory login response profile.id (not persisted userValue), and
      // the proof from that same login when there is one. Without one this sends
      // the body an older client sent.
      this.attemptWork.add(this.authenticationService.resendOtp('id',this.log_in.profile.id,this.loginResendProof).subscribe({
        next: (x:any)=>{
          this.toast.success(x.message);
        },
        error: (error: any) => {
          if (error === 'rate_limited') {
            this.rateLimited = true;
          }
        }
      }))
      // You can add your OTP resend logic here (e.g., API call)
    }
    backToLogin(): void {
      if (this.timer) { clearInterval(this.timer); }
      this.endLoginAttempt();
      this.countdown = 30;
      this.data = '';
      this.attempt = 0;
      this.error = '';
      this.isSubmittingOtp = false;
      this.submitted = false;
      this.loginForm.reset();
      this.require_otp = false;
      this.showLoginForm = true;
    }
  /**
   * Default landing path for a single restaurant membership, derived from its
   * RBAC permissions map via the shared firstAccessibleRoute helper:
   *  - a present map lands on the first module the user can access (e.g. a
   *    Tables-only staff lands on /dining-tables, NOT the bare portal root
   *    that used to bounce through the dashboard redirect);
   *  - a map granting no module lands on /account (the same predicate
   *    that drives the sidebar "No modules assigned" note — they can't diverge);
   *  - an absent map (pre-permissions snapshot) falls back on roles: kitchen-only
   *    staff to the Kitchen board, everyone else to the dashboard.
   * This is for a user who HAS a membership; the zero-membership /welcome branch
   * lives at the call sites. The post-login redirect always uses this landing
   * route — it no longer honors a returnUrl deep link.
   */
  private landingPathForMembership(membership: RestaurantRole): string {
    return firstAccessibleRoute(membership?.permissions, membership?.roles);
  }

    setRestaurant(restaurant: RestaurantRole) {
  this.authenticationService.setCurrentRestaurantRole(restaurant);

  this.router.navigateByUrl(this.landingPathForMembership(restaurant));

  this.showRestaurantSelector = false; // close selector after selection
}

}
