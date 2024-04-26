import { NgModule, forwardRef } from '@angular/core';
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
import { NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { RegisterComponent } from './auth/register/register.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { ChangePasswordComponent } from './auth/change-password/change-password.component';
import { ConfirmDialogComponent } from './_common/confirm-dialog/confirm-dialog.component';
import { CurrencyInputComponent } from './_common/currency-input/currency-input.component';
import { CurrencyModule } from './_common/currency-input/currency-input.module';
import { InputModule } from './_common/currency-input/input.module';
import { CommonImageComponent } from './_common/common-image/common-image.component';
import { RestaurantMgtModule } from './restaurant-mgt/restaurant-mgt.module';
import { DinifyMgtModule } from './dinify-mgt/dinify-mgt.module';
import { DinerAppModule } from './diner-app/diner-app.module';

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
    ConfirmDialogComponent
    /* CurrencyInputComponent */
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    InputModule,
    ReactiveFormsModule,
    NgxIntlTelephoneInputModule,
    RestaurantMgtModule,
    DinifyMgtModule,
    DinerAppModule
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
  
  /*   { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CurrencyInputComponent), multi: true  } */
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
