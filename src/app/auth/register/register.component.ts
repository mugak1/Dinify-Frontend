import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, UntypedFormGroup, Validators } from '@angular/forms';
import { DinifyPhoneInputComponent } from 'src/app/shared/dinify-phone-input/dinify-phone-input.component';
import { ApiService } from 'src/app/_services/api.service';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';
import { isNoAccountAnswer } from 'src/app/_helpers/account-lookup';

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-register',
    templateUrl: './register.component.html',
    styleUrls: ['./register.component.css'],
    standalone: false
})
export class RegisterComponent {
  @Input() as_diner:boolean=false;
  @Output() saved = new EventEmitter<any>();
  is_submitted=false;
  require_otp=false;
  data='';
  @ViewChild('phoneregister', { static: false }) public phoneComponent?: DinifyPhoneInputComponent;
  RegisterForm!:FormGroup;
  constructor(private api:ApiService,private fb:FormBuilder, private toast:ToastService) {
      this.RegisterForm=this.initRegisterForm();
  }

  initRegisterForm(){
    return this.fb.group({
      first_name: ["",Validators.required],
      last_name: ["",Validators.required],
      phone_number: ["",Validators.required],
      password: ['',[Validators.required,Validators.minLength(6),Validators.pattern('^(?=.*[!@#$&*()<>?{}|,`~.%])(.*[0-9].*)+$')]],
      confirm_password: ["",Validators.required],  

      country: ["UG"],
      email:[''],
      ok:[false,Validators.requiredTrue],
      otp:['']
    },
    {
      validator: ConfirmPasswordValidator("password", "confirm_password")
    })
  }
  checkMatch(e:any, i:any) {
    return new RegExp(i).test(e)
}

get newpassword() {
    return this.RegisterForm.get("password")
}
  Register(){
    if(this.RegisterForm.get('phone_number')?.value&&!this.require_otp){
      const msisdn = this.RegisterForm.get('phone_number')?.value;
      this.api.get<any>(null,'users/msisdn-lookup/?msisdn='+msisdn).subscribe({
        next: (x) => {
          if(x.status==200){
            this.RegisterUser();
          }
        },
        error: (err) => {
          // No account holds this number yet: the lookup answers HTTP 404
          // (see account-lookup.ts), so start sign-up by sending the OTP to
          // the number that was looked up.
          if (isNoAccountAnswer(err)) {
            this.sendOtp('msisdn', msisdn, null);
          }
          // Any other failure is not "no account". Reporting it is
          // ErrorInterceptor's job, as it was before.
        },
      })
    }else{
      if(this.data){
        this.RegisterForm.get('otp')?.setValue(this.data);
        this.RegisterUser();
      }

    }

  }
  RegisterUser(){
    this.api.postPatch('users/auth/register/',this.RegisterForm.value,'post').subscribe({
      next: (x:any)=>{
        this.toast.success(x.message);
        this.RegisterForm=this.initRegisterForm();
        this.data='';
        this.saved.emit(x);
      },
      error: () => {
        // Nothing to undo. A refusal (a number that already has an account, a
        // wrong or expired OTP) or a failed request is reported by
        // ErrorInterceptor, and the form keeps what was entered so the person
        // can correct it and try again. Handling it here stops the failure
        // reaching RxJS as an unhandled error.
      },
    })
  }

 onInputChange($event:any){
this.RegisterForm.get('phone_number')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
this.RegisterForm.get('country')?.setValue(String($event.iso2Code).toUpperCase())
 }

 sendOtp(identification:any,identifier:any,purpose:any){
  this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(_x=>{
    this.require_otp=true 
    // store user details and jwt token in local storage to keep user logged in between page refreshes
    //  localStorage.setItem('user', JSON.stringify((response.data)));
    //  this.userSubject.next(response.data as any)
     
  });
}
}
export function ConfirmPasswordValidator(controlName: string, matchingControlName: string) {
  return (formGroup: UntypedFormGroup) => {
    const control = formGroup.controls[controlName];
    const matchingControl = formGroup.controls[matchingControlName]
    if (
      matchingControl.errors&&
      !matchingControl.errors?.['confirmPasswordValidator']
    ) {
      return;
    }
    if (control.value !== matchingControl.value) {
      matchingControl.setErrors({ confirmPasswordValidator: true });
    } else {
      matchingControl.setErrors(null);
    }
  };
}
