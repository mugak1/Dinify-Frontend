import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css']
})
export class ForgotPasswordComponent {
submitted:boolean=false;
  constructor(private fb:FormBuilder) {
    
  }
  ForgotPasswordForm:FormGroup=this.fb.group({
    email:['',[Validators.required,Validators.email]]
  })
  Reset(){
this.submitted=true;
  }
}
