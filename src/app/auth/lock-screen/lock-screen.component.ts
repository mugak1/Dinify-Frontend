import { HttpClient } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../_services/api.service';
import { MessageService } from 'src/app/_services/message.service';

@Component({
  selector: 'app-lock-screen',
  templateUrl: './lock-screen.component.html',
  styleUrls: ['./lock-screen.component.css']
})
export class LockScreenComponent implements OnInit {
  unlocking = false;
  fieldTextType = false;
  fieldTextTypeConfirm = false;
  LockScreenForm:FormGroup;
  user: any;
  username: any;
  oldpassword?: string;
  token: any;
  message: any;
  constructor(private http:HttpClient,private fb:FormBuilder,private routes:ActivatedRoute,
    private api:ApiService, private router:Router,private messageService:MessageService) {
    this.LockScreenForm= this.fb.group({
      username: [""],
      old_password: [null],
      new_password: [null,[Validators.required,Validators.pattern(/^(?=.*[0-9])(?=.*[!@#$%^&*])/),Validators.minLength(6)]],
      confirmPassword: ["", [Validators.required]]
  }, { validator: this.passwordsMatch });
   }

   ngOnInit() {
    this.routes.params.subscribe(e=>{
        this.user = e['fullname'] ? e['fullname'] : "name",
        this.username = e['username'],
        this.oldpassword = atob(e['otp']),
        this.token = e['token']
    })
}
checkMatch(e:any, i:any) {
    return new RegExp(i).test(e)
}
get ProfileLetter() {
    return this.user.split(" ").map((n:any)=>n[0]).join(".")
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
    this.unlocking = true,
    this.LockScreenForm.get("username")?.setValue(this.username),
    this.LockScreenForm.get("old_password")?.setValue(this.oldpassword),
    this.api.UserChangePasswordOnLogin(this.LockScreenForm.value).subscribe({
        next:(value:any)=>{
          this.unlocking = false,
        this.router.navigate(["/login"])
this.messageService.addMessage({severity:'info', summary:'info',message:value?.body.message})
    }, error:(err:any)=>{
        this.unlocking = false,
        this.message = err
    }
});
    
    
}
ResetPassword() {
    this.api.postPatch("users/auth/reset-password/", {
        username: this.LockScreenForm.get("username")?.value
    }, "post").subscribe(e=>{
        this.router.navigate(["/login"])
    }
    , e=>{

    }
    , ()=>{
       // this.router.navigate(["/login"])
    }
    )
}
passwordsMatch(group: FormGroup): { [key: string]: boolean } | null {
    const newPassword = group.get('new_password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;
    return newPassword === confirmPassword ? null : { passwordMismatch: true };
  }


}
