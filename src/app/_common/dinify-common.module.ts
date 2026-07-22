import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommonImageComponent } from './common-image/common-image.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import { ScrollSpyCommonDirective } from './scroll-spy-common.directive';
import { DinifyPhoneInputComponent } from '../shared/dinify-phone-input/dinify-phone-input.component';
import { CommonUserProfileComponent } from './common-user-profile/common-user-profile.component';
import { OtpInputComponent } from './otp-input/otp-input.component';
import { CommonNotificationsComponent } from './common-notifications/common-notifications.component';
import { SafePipe } from './common.pipe';



@NgModule({
  declarations: [
    CommonImageComponent,
    ConfirmDialogComponent,
    CommonUserProfileComponent,
    OtpInputComponent,
    CommonNotificationsComponent,
    SafePipe,
  ],
  exports:[
    CommonImageComponent,
    ConfirmDialogComponent,
   CommonUserProfileComponent,
   OtpInputComponent,
   CommonNotificationsComponent ,
   SafePipe,
   ScrollSpyCommonDirective
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DinifyPhoneInputComponent,
    FormsModule,
    ScrollSpyCommonDirective,
  ]
})
export class DinifyCommonModule { }

