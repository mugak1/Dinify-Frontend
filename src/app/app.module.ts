import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { DinifyMgtComponent } from './dinify-mgt/dinify-mgt.component';
import { DinerAppComponent } from './diner-app/diner-app.component';
import { LoginComponent } from './auth/login/login.component';
import { AuthInterceptor } from './_helpers/auth.interceptor';
import { DinerSessionInterceptor } from './_helpers/diner-session.interceptor';
import { ErrorInterceptor } from './_helpers/error.interceptor';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RegisterComponent } from './auth/register/register.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { DinifyCommonModule } from "./_common/dinify-common.module";
import { LockScreenComponent } from './auth/lock-screen/lock-screen.component';
import { WelcomeComponent } from './auth/welcome/welcome.component';
import { StorageModule } from './_services/storage/storage.module';
import { NoTableComponent } from './diner-app/no-table/no-table.component';
import { DinerConnectionErrorComponent } from './diner-app/connection-error/connection-error.component';
import { OfflineStripComponent } from './diner-app/offline-strip/offline-strip.component';
import { BasketBodyComponent } from './diner-app/basket/basket-body/basket-body.component';
import { DinerFooterComponent } from './diner-app/diner-footer/diner-footer.component';
import { MenuNavBarComponent } from './diner-app/menu/menu-nav-bar/menu-nav-bar.component';
import { ToastComponent } from './_shared/ui/toast/toast.component';
import { OfflineBannerComponent } from './_shared/ui/offline-banner/offline-banner.component';
import { ScrollProgressDirective } from './diner-app/_shared/scroll-progress.directive';
import { DinifyPhoneInputComponent } from './shared/dinify-phone-input/dinify-phone-input.component';
import { AuthShellComponent } from './auth/auth-shell/auth-shell.component';

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
        ReactiveFormsModule,
        DinifyCommonModule,
        FormsModule,
        StorageModule.forRoot({ prefix: 'dinify' }),
        NoTableComponent,
        DinerConnectionErrorComponent,
        OfflineStripComponent,
        BasketBodyComponent,
        DinerFooterComponent,
        MenuNavBarComponent,
        ToastComponent,
        OfflineBannerComponent,
        ScrollProgressDirective,
        DinifyPhoneInputComponent,
        AuthShellComponent], providers: [
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: DinerSessionInterceptor, multi: true },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
    ] })
export class AppModule { }
