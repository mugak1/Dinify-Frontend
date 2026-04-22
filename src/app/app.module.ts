import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { NgxIntlTelephoneInputModule } from "ngx-intl-telephone-input";

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { DinifyMgtComponent } from './dinify-mgt/dinify-mgt.component';
import { DinerAppComponent } from './diner-app/diner-app.component';
import { LoginComponent } from './auth/login/login.component';
import { AuthInterceptor } from './_helpers/auth.interceptor';
import { ErrorInterceptor } from './_helpers/error.interceptor';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RegisterComponent } from './auth/register/register.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { InputModule } from './_common/currency-input/input.module';
import { DinifyCommonModule } from "./_common/dinify-common.module";
import { LockScreenComponent } from './auth/lock-screen/lock-screen.component';
import { WelcomeComponent } from './auth/welcome/welcome.component';
import { StorageModule } from './_services/storage/storage.module';
import { NoTableComponent } from './diner-app/no-table/no-table.component';
import { BasketBodyComponent } from './diner-app/basket/basket-body/basket-body.component';
import { DinerFooterComponent } from './diner-app/diner-footer/diner-footer.component';

@NgModule({ declarations: [
        AppComponent,
        DinifyMgtComponent,
        DinerAppComponent,
        LoginComponent,
        RegisterComponent,
        ForgotPasswordComponent,
        LockScreenComponent,
        WelcomeComponent
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        AppRoutingModule,
        InputModule,
        ReactiveFormsModule,
        NgxIntlTelephoneInputModule,
        DinifyCommonModule,
        FormsModule,
        StorageModule.forRoot({ prefix: 'dinify' }),
        NoTableComponent,
        BasketBodyComponent,
        DinerFooterComponent], providers: [
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
    ] })
export class AppModule { }
