import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { NgxIntlTelephoneInputModule } from "ngx-intl-telephone-input";

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { DinifyMgtComponent } from './dinify-mgt/dinify-mgt.component';
import { RestaurantMgtComponent } from './restaurant-mgt/restaurant-mgt.component';
import { DinerAppComponent } from './diner-app/diner-app.component';
import { LoginComponent } from './auth/login/login.component';
import { AuthInterceptor } from './_helpers/auth.interceptor';
import { ErrorInterceptor } from './_helpers/error.interceptor';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RegisterComponent } from './auth/register/register.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { ChangePasswordComponent } from './auth/change-password/change-password.component';
import { InputModule } from './_common/currency-input/input.module';
import { DinifyCommonModule } from "./_common/dinify-common.module";
import { LockScreenComponent } from './auth/lock-screen/lock-screen.component';
import { WelcomeComponent } from './auth/welcome/welcome.component';

@NgModule({
  declarations: [
    AppComponent,
    DinifyMgtComponent,
    //RestaurantMgtComponent,
    DinerAppComponent,
    LoginComponent,
    RegisterComponent,
    ForgotPasswordComponent,
    ChangePasswordComponent,
    LockScreenComponent,
    WelcomeComponent
    /* CurrencyInputComponent */
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    InputModule,
    ReactiveFormsModule,
    NgxIntlTelephoneInputModule,
    DinifyCommonModule,
    FormsModule,
],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
  
  /*   { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CurrencyInputComponent), multi: true  } */
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
