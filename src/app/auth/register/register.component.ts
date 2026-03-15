import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, UntypedFormGroup, Validators } from '@angular/forms';
import {
  CountryISO,
  NgxIntlTelephoneInputComponent,
  PhoneNumberFormat,
  SearchCountryField
} from "ngx-intl-telephone-input";
import { ApiResponse } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { MessageService } from 'src/app/_services/message.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  @Input() as_diner:boolean=false;
  @Output() saved = new EventEmitter<any>();
  is_submitted=false;
  require_otp=false;
  data='';
  @ViewChild('phoneregister', { static: false }) public phoneComponent?: NgxIntlTelephoneInputComponent;
  RegisterForm!:FormGroup;
  constructor(private api:ApiService,private fb:FormBuilder, private message:MessageService) {
      this.RegisterForm=this.initRegisterForm();
  }

  separateDialCode = false;
  SearchCountryField = SearchCountryField;
 // TooltipLabel = TooltipLabel;
  CountryISO = CountryISO;
  number_format = PhoneNumberFormat.National
  preferredCountries: CountryISO[] = [
    CountryISO.Uganda,
    CountryISO.Kenya
  ];
  initRegisterForm(){
    return this.fb.group({
      first_name: ["",Validators.required],
      last_name: ["",Validators.required],
      phone:[''],
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
      this.api.get<any>(null,'users/msisdn-lookup/?msisdn='+this.RegisterForm.get('phone_number')?.value).subscribe((x)=>{
        if(x.status==400){
        // this.require_otp=true
         this.sendOtp('msisdn',this.RegisterForm.get('phone_number')?.value,null);
        }else if(x.status==200){
  this.RegisterUser();
        }
      })
    }else{
      if(this.data){
        this.RegisterForm.get('otp')?.setValue(this.data);
        this.RegisterUser();
      }

    }

  }
  RegisterUser(){
    this.api.postPatch('users/auth/register/',this.RegisterForm.value,'post').subscribe((x:any)=>{
  
      this.message.add(x.message);
      this.RegisterForm=this.initRegisterForm();
      this.data='';
      this.saved.emit(x);
    })
  }

 onInputChange($event:any){
this.RegisterForm.get('phone')?.setValue($event);
this.RegisterForm.get('phone_number')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
this.RegisterForm.get('country')?.setValue(String($event.iso2Code).toUpperCase())
 }

 sendOtp(identification:any,identifier:any,purpose:any){
  this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(x=>{
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
