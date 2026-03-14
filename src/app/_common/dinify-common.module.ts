import { NgModule, Pipe, PipeTransform } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CommonImageComponent } from './common-image/common-image.component';
import { DatePickerComponent } from './date-picker/date-picker.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AutoCompleteComponent } from './auto-complete/auto-complete.component';
import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import { MenuCommonComponent } from './menu-common/menu-common.component';
import { ScrollSpyCommonDirective } from './scroll-spy-common.directive';
import { CommonUsersComponent } from './common-users/common-users.component';
import { NgxIntlTelephoneInputModule } from 'ngx-intl-telephone-input';
import { CommonUserProfileComponent } from './common-user-profile/common-user-profile.component';
import { OtpInputComponent } from './otp-input/otp-input.component';
import { CommonNotificationsComponent } from './common-notifications/common-notifications.component';
import { DomSanitizer, SafeHtml, SafeResourceUrl, SafeScript, SafeStyle, SafeUrl } from '@angular/platform-browser';
import { SafePipe } from './common.pipe';
import { CommonChartComponent } from './common-chart/common-chart.component';
import { NgApexchartsModule } from 'ng-apexcharts';



@NgModule({
  declarations: [
    CommonImageComponent,
    DatePickerComponent,
    AutoCompleteComponent,
    ConfirmDialogComponent,
    MenuCommonComponent,
    ScrollSpyCommonDirective,
    CommonUsersComponent,
    CommonUserProfileComponent,
    OtpInputComponent,
    CommonNotificationsComponent,
    SafePipe,
    CommonChartComponent
  ],
  exports:[
    CommonImageComponent,
    DatePickerComponent,
    AutoCompleteComponent,
    ConfirmDialogComponent,
    MenuCommonComponent,
   CommonUsersComponent,
   CommonUserProfileComponent,
   OtpInputComponent,
   CommonNotificationsComponent ,
   SafePipe,
   CommonChartComponent,
   ScrollSpyCommonDirective
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NgxIntlTelephoneInputModule,
    FormsModule,    
    NgApexchartsModule,
  ]
})
export class DinifyCommonModule { }

