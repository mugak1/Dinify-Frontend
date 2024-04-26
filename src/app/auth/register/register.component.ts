import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  CountryISO,
  PhoneNumberFormat,
  SearchCountryField
} from "ngx-intl-telephone-input";
import { ApiResponse } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {

  is_submitted=false;
  RegisterForm:FormGroup=this.fb.group({
    first_name: ["",Validators.required],
    last_name: ["",Validators.required],
    phone:[''],
    phone_number: ["",Validators.required],
    password: ['', [Validators.required]],
    country: [""],
    email:[''],
    ok:[false,Validators.requiredTrue]
  });
  constructor(private api:ApiService,private fb:FormBuilder) {
      
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
      first_name: ["Esau",Validators.required],
      last_name: ["Lwanga",Validators.required],
      phone:[''],
      phone_number: ["256712345678",Validators.required],
      password: ['', [Validators.required]],
      country: ["UG"],
      email:[''],
      ok:[false,Validators.requiredTrue]
    })
  }
  Register(){
this.api.postPatch('users/auth/register/',this.RegisterForm.value,'post').subscribe(x=>{
  console.log(x);
})
  }
 onInputChange($event:any){
this.RegisterForm.get('phone')?.setValue($event);
this.RegisterForm.get('phone_number')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
this.RegisterForm.get('country')?.setValue(String($event.iso2Code).toUpperCase())
 }
}
