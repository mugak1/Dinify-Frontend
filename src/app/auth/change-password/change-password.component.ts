import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, UntypedFormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-change-password',
  templateUrl: './change-password.component.html',
  styleUrls: ['./change-password.component.css']
})
export class ChangePasswordComponent implements OnInit {
  unlocking = false;
  fieldTextType = false;
  fieldTextTypeConfirm = false;
  LockScreenForm:FormGroup;
  user: any;
  username: any;
  oldpassword: string='';
  token: any;
  message: any;
  constructor(private http:HttpClient,private fb:FormBuilder,private routes:ActivatedRoute,private router:Router) {
    this.LockScreenForm= this.fb.group({
      username: [""],
      current_password: [null],
      new_password: ["",[Validators.required,Validators.minLength(6),Validators.pattern('^(?=.*[!@#$&*()<>?{}|,`~.%])(.*[0-9].*)+$')]],
      confirmPassword: ["",Validators.required]
    },
    {
      validator: ConfirmPasswordValidator("new_password", "confirmPassword")
    })

   }
   ngOnInit() {
    this.routes.params.subscribe(e=>{
        this.user = e['fullname'] ? e['fullname'] : "name",
        this.username = e['username'],
        this.oldpassword = atob(e['otp']),
        this.token = e['token']
    }
    )
}
checkMatch(e:any, i:any) {
    return new RegExp(i).test(e)
}
get ProfileLetter() {
    return this.user.charAt(0)
}
get newpassword() {
    return this.LockScreenForm.get("new_password")
}
toggleFieldTextType() {
    this.fieldTextType = !this.fieldTextType
}
toggleFieldTextTypeConfirm() {
    this.fieldTextTypeConfirm = !this.fieldTextTypeConfirm
}
Send() {
    this.unlocking = true;
    this.LockScreenForm?.get("username")?.setValue(this.username);
    this.LockScreenForm?.get("current_password")?.setValue(this.oldpassword);
 /*    this.api.UserChangePasswordOnLogin(this.LockScreenForm.value, this.token).subscribe(e=>{
          this.unlocking = false,
        this.router.navigate(["/login"])
    }
    , e=>{
        this.unlocking = false,
        this.message = e
    }
    , ()=>{
      
    }
    ) */
}
ResetPassword() {
/*     this.api.postPatch("users/auth/reset-password/", {
        username: this.LockScreenForm.get("username").value
    }, "post").subscribe(e=>{
        this.router.navigate(["/login"])
    }
    , e=>{

    }
    , ()=>{
       // this.router.navigate(["/login"])
    }
    ) */
}
ValidationMatch(t:any) {
  return (e:any)=>{
      
      if (e.parent) {
          const l = e.controls[t];
          return l.updateValueAndValidity()
      }
      return e.parent?.controls[t] ? null : {matching: false }
  }
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