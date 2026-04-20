import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RestaurantMgtComponent } from './restaurant-mgt/restaurant-mgt.component';
import { DinifyMgtComponent } from './dinify-mgt/dinify-mgt.component';
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { AuthGuard } from './_helpers/auth.guard';
import { DinerAppComponent } from './diner-app/diner-app.component';
import { LockScreenComponent } from './auth/lock-screen/lock-screen.component';
import { WelcomeComponent } from './auth/welcome/welcome.component';

const routes: Routes = [
  {path:'',redirectTo:'login',pathMatch:'full'},
{path:'login', component:LoginComponent,title:'Login'},
{path:'register',component:RegisterComponent, title:'Register'},
{path:'forgot-password',component:ForgotPasswordComponent, title:'Forgot Password'},
{path:'welcome',component:WelcomeComponent,title:'Welcome'},
{path:'rest-app',component:RestaurantMgtComponent,canActivate:[AuthGuard],data:{roles:['restaurant_staff']},loadChildren: () => import('./restaurant-mgt/restaurant-mgt.module').then(m => m.RestaurantMgtModule)},
{path:'mgt-app',component:DinifyMgtComponent,canActivate:[AuthGuard],data:{roles:['dinify_admin']},loadChildren: () => import('./dinify-mgt/dinify-mgt.module').then(m => m.DinifyMgtModule)},
{path:'diner',component:DinerAppComponent,loadChildren: () => {
  console.log('[DIAG] Lazy-loading DinerAppModule');
  return import('./diner-app/diner-app.module').then(m => {
    console.log('[DIAG] DinerAppModule loaded:', m);
    return m.DinerAppModule;
  });
}},
{ path: "lock-otp-exp", component: LockScreenComponent },
{ path: 'privacy', loadComponent: () => import('./legal/privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent), title: 'Privacy Policy' },
{ path: 'terms', loadComponent: () => import('./legal/terms-and-conditions/terms-and-conditions.component').then(m => m.TermsAndConditionsComponent), title: 'Terms and Conditions' },
{ path: 'cookies', loadComponent: () => import('./legal/cookie-policy/cookie-policy.component').then(m => m.CookiePolicyComponent), title: 'Cookie Policy' },
    // otherwise redirect to home
{ path: '**', redirectTo: 'login' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
