import { LocationStrategy } from '@angular/common';
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
submitted:boolean=false;
@Input() as_diner:boolean=false;
  @Output() LoginResp= new EventEmitter<any>();
  selectedOption:any;
  email:any;
  countryCode:any;
  phoneNumber:any;
  require_otp: boolean=false;
  isSubmittingOtp=false;
  countdown = 30; // Countdown starts at 30 seconds
  timer: any;
  data=''
  constructor(private fb:FormBuilder, private api:ApiService, private router:Router, private locationAPi:LocationStrategy,private messageService:MessageService) {
this.ForgotPasswordForm= this.fb.group({
      selectedOption: ['', Validators.required], // Require the user to select an option
      email: ['', [Validators.email]], // Validate email format if entered
      phoneNumber: ['', [Validators.pattern(/^\d{9}$/)]], // Ensure phone number is 9 digits
    }, { validator: this.requireContactMethod.bind(this) });
//this.SetChanges();
  }
  ForgotPasswordForm!:FormGroup;

  // Custom validator to ensure at least one contact method is provided
  requireContactMethod(group: FormGroup) {
    const selectedOption = group.get('selectedOption')?.value;
    const email = group.get('email')?.value;
    const phoneNumber = group.get('phoneNumber')?.value;

    if ((selectedOption === 'email' && !email) || (selectedOption === 'phone' && !phoneNumber)) {
      return { contactMethodRequired: true };
    }
    return null;
  }
  intForm(){
    return this.fb.group({
      selectedOption:['',Validators.required],
      email:[''],
      phoneNumber:['']
    })
  }
  Reset(){
this.submitted=true;
  }
  SetChanges(){
/*     this.ForgotPasswordForm.valueChanges.subscribe((e:any)=>{
    
      if(e.selectedOption=="email"){
        this.ForgotPasswordForm.get("phoneNumber")?.clearValidators();
        this.ForgotPasswordForm.get("phoneNumber")?.updateValueAndValidity();
        this.ForgotPasswordForm.get("email")?.setValidators([Validators.email,Validators.required]);
        this.ForgotPasswordForm.get("email")?.updateValueAndValidity();
      }
      else if(e.selectedOption=="phoneNumber"){
        this.ForgotPasswordForm.get("email")?.clearValidators();
        this.ForgotPasswordForm.get("email")?.updateValueAndValidity();
        this.ForgotPasswordForm.get("phoneNumber")?.setValidators([Validators.pattern("^[0-9]*$"), Validators.minLength(10), Validators.maxLength(10),Validators.required]);
        this.ForgotPasswordForm.get("phoneNumber")?.updateValueAndValidity();
      }
    }) */
  }
  ResetPassword() {
this.sendOtp(this.ForgotPasswordForm.get("selectedOption")?.value=='email'?this.ForgotPasswordForm.get("email")?.value:"256"+this.replaceLeadingZero(this.ForgotPasswordForm.get("phoneNumber")?.value,'0'),this.ForgotPasswordForm.get("selectedOption")?.value,'reset_password');

    
}
replaceLeadingZero(phoneNumber:any, replacementString:any) {
  // Check if the phone number starts with '0'
  if (phoneNumber.startsWith('0')) {
    // Replace the leading '0' with the replacement string
    return replacementString + phoneNumber.slice(1);
  }
  // Return the original phone number if it doesn't start with '0'
  return phoneNumber;
}
sendOtp(identification:any,identifier:any,purpose:any){
  this.require_otp = false;
  this.submitted = true;
  this.isSubmittingOtp = false;
  this.api.postPatch('users/auth/resend-otp/',
    {
      "identifier": identification, 
      "identification": identifier,
      "skip_auth": "yes"
    },'post').subscribe(x=>{
  this.startCountdown();
    this.require_otp=true;
    this.submitted=false; 
    // store user details and jwt token in local storage to keep user logged in between page refreshes
    //  localStorage.setItem('user', JSON.stringify((response.data)));
    //  this.userSubject.next(response.data as any)
     
  }, 
  (error: any) => {
     // this.error = error;
     this.submitted = false
      alert(error)
  },);
}
Submit(){
  this.submitted=true;
  this.isSubmittingOtp=true;
  this.api.postPatch("users/auth/reset-password/", {
    phone_number: (this.ForgotPasswordForm.get("selectedOption")?.value=='email')?this.ForgotPasswordForm.get("email")?.value:"256"+this.ForgotPasswordForm.get("phoneNumber")?.value,
    otp:this.data
  }, "post").subscribe((e:any)=>{
    if(e?.status==200){

      ////  add otp
      this.messageService.addMessage({severity:'info', summary:'Success', message:e.message});
      this.ForgotPasswordForm.get("phone_number")?.setValue("");
      this.data=''
      this.submitted=false;
      this.isSubmittingOtp=false;
      this.require_otp=false;
      this.countdown = 30; // Reset the countdown
      setTimeout(() => {
        this.router.navigate(["/login"])
      }, 1500);
     /*  setTimeout(() => {
        this.messageService.clear();
      }, 4500); */
     // this.LoginResp.emit(e);
    }
    else if(e?.status==400){
      this.submitted=false;
      this.isSubmittingOtp=false;
      
      this.messageService.addMessage({severity:'error', summary:'Error', message:e?.message});
      this.ForgotPasswordForm.get("phone_number")?.setValue("");
      this.data=''
      //this.ForgotPasswordForm.get("otp")?.setValue("");
      this.require_otp=false;
      this.LoginResp.emit(e);
    }else{
      
      this.LoginResp.emit(e);
    }
     // this.router.navigate(["/login"])
   //  this.locationAPi.back();
  }
  , e=>{
this.isSubmittingOtp=false;
this.submitted =false;
    this.messageService.addMessage({severity:'error', summary:'Error', message:e});
    this.ForgotPasswordForm.get("phone_number")?.setValue("");
    this.data=''
    //this.ForgotPasswordForm.get("otp")?.setValue("");
    this.require_otp=false;
  }
  , ()=>{
     // this.router.navigate(["/login"])
  }
  )
}
resendOTP(){
  this.countdown = 30; // Reset the countdown
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
  }, 1000); // Decrease the countdown every second
}
}
