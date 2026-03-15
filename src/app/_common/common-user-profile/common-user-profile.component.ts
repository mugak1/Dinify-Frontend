import { AfterViewInit, Component, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { SearchCountryField, CountryISO, PhoneNumberFormat, NgxIntlTelephoneInputComponent } from 'ngx-intl-telephone-input';
import { Profile } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MessageService } from 'src/app/_services/message.service';

@Component({
  selector: 'app-common-user-profile',
  templateUrl: './common-user-profile.component.html',
  styleUrl: './common-user-profile.component.css'
})
export class CommonUserProfileComponent implements AfterViewInit {
showModal=false;
user?:Profile;
@Input() action:string='view';
is_submitted=false;
@Output() save= new EventEmitter<any>();
@ViewChild('phone_edit', { static: false }) public phoneComponent?: NgxIntlTelephoneInputComponent;
change_number=false;
require_otp=false;
data='';
RegisterForm:FormGroup=this.fb.group({
  id:[''],
  first_name: [""],
  last_name: [""],
  phone:[''],
  phone_number: [""],
  old_number:[''],
  password: [''],
  country: [""],
  email:[''],
  otp:['']
});
separateDialCode = false;
SearchCountryField = SearchCountryField;
// TooltipLabel = TooltipLabel;
CountryISO = CountryISO;
number_format = PhoneNumberFormat.National
preferredCountries: CountryISO[] = [
  CountryISO.Uganda,
  CountryISO.Kenya
];
closeModal(){
  this.showModal=false;
}
SaveEdit(){
  if(this.change_number&&this.RegisterForm.get('old_phone')?.value!=this.RegisterForm.get('phone_number')?.value&&!this.require_otp){
this.sendOtp('msisdn',this.RegisterForm.get('old_phone')?.value,null);
  }else{
    if(this.RegisterForm.get('old_phone')?.value!=this.RegisterForm.get('phone_number')?.value){
      this.RegisterForm.get('phone_number')?.setValue(null)
    }

  this.api.postPatch('users/user-profile/',this.RegisterForm.value,'put').subscribe((x:any)=>{
     // this.closeModal();
this.auth.updateProfile(x.data.profile);
      this.save.emit(x)
      this.message.add(x.message)
      setTimeout(() => {      
        this.message.clear(); 
      }, 800);
      }) 
    
  }
}
onInputChange($event:any){
  this.RegisterForm.get('phone')?.setValue($event);
  this.RegisterForm.get('phone_number')?.setValue(String($event.phoneNumber).replace('+','').replace(/\s/g, ""));
  this.RegisterForm.get('country')?.setValue(String($event.iso2Code).toUpperCase())
  }
/**
 *
 */
constructor(private auth:AuthenticationService,private fb:FormBuilder, private api:ApiService, private message:MessageService) {
  this.user= this.auth.userValue?.profile
  this.RegisterForm.patchValue(this.user as any);
  this.RegisterForm.get('old_number')?.setValue(this.user?.phone_number)
 
  //this.RegisterForm.get('phone')?.setValue(this.user?.phone_number)
}
  // eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
  ngAfterViewInit(): void {
    // intentionally empty - required by AfterViewInit interface
  }
  CancelChange(){
    this.change_number=!this.change_number
    if(this.change_number==false){
        this.RegisterForm.get('phone_number')?.setValue(this.RegisterForm.get('old_number')?.value);  
    }

  }
  sendOtp(identification:any,identifier:any,purpose:any){
    this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(_x=>{
      this.require_otp=true 
      // store user details and jwt token in local storage to keep user logged in between page refreshes
      //  localStorage.setItem('user', JSON.stringify((response.data)));
      //  this.userSubject.next(response.data as any)
       
    });
  }
  SubmitWithOTP(){
    this.RegisterForm.get('otp')?.setValue(this.data);
    this.api.postPatch('users/user-profile/',this.RegisterForm.value,'put').subscribe((x:any)=>{
      this.auth.updateProfile(x.data.profile);
       this.message.add(x?.message);
       
      setTimeout(() => {      
        this.message.clear(); 
      }, 800);
     
      this.save.emit(x)

      }) 
    
  }
}
