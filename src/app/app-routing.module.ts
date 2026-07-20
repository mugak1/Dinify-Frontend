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
import { KitchenComponent } from './kitchen/kitchen.component';
import { redirectLegacyRestAppUrl } from './_helpers/legacy-rest-app-redirect';
import { DINER_MOUNT_EMBEDDED } from './diner-app/diner-mount';

export const routes: Routes = [
  {path:'',redirectTo:'login',pathMatch:'full'},
{path:'login', component:LoginComponent,title:'Login'},
{path:'register',component:RegisterComponent, title:'Register'},
{path:'forgot-password',component:ForgotPasswordComponent, title:'Forgot Password'},
{path:'welcome',component:WelcomeComponent,title:'Welcome'},
{path:'mgt-app',component:DinifyMgtComponent,canActivate:[AuthGuard],data:{roles:['dinify_admin']},loadChildren: () => import('./dinify-mgt/dinify-mgt.module').then(m => m.DinifyMgtModule)},
{path:'diner',component:DinerAppComponent,data:{[DINER_MOUNT_EMBEDDED]: false},loadChildren: () => import('./diner-app/diner-app.module').then(m => m.DinerAppModule)},
// Kitchen View — staff-only board on live order data. Policy mirrors the Phase 2
// backend: platform dinify_admin / dinify_account_manager, or a restaurant
// owner / manager / kitchen role (handled additively via data.restaurant_roles).
{path:'kitchen',component:KitchenComponent,canActivate:[AuthGuard],data:{roles:['dinify_admin','dinify_account_manager'],restaurant_roles:['owner','manager','kitchen']},loadChildren: () => import('./kitchen/kitchen.module').then(m => m.KitchenModule)},
{ path: "lock-otp-exp", component: LockScreenComponent },
{ path: 'privacy', loadComponent: () => import('./legal/privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent), title: 'Privacy Policy' },
{ path: 'terms', loadComponent: () => import('./legal/terms-and-conditions/terms-and-conditions.component').then(m => m.TermsAndConditionsComponent), title: 'Terms and Conditions' },
{ path: 'cookies', loadComponent: () => import('./legal/cookie-policy/cookie-policy.component').then(m => m.CookiePolicyComponent), title: 'Cookie Policy' },
// Legacy portal URLs from before the hoist to the URL root: strip the leading
// `rest-app` segment (bare `/rest-app` -> `/dashboard`), preserving query
// params + fragment. See redirectLegacyRestAppUrl for the behaviour contract.
{path:'rest-app', children: [
  {path:'', pathMatch:'full', redirectTo: redirectLegacyRestAppUrl},
  {path:'**', redirectTo: redirectLegacyRestAppUrl},
]},
// The restaurant portal owns the URL ROOT. This empty-path parent
// prefix-matches every URL no route above claimed, and its lazy children end
// in a `**` wildcard — so any NEW root-level route MUST be declared ABOVE this
// entry or the portal will swallow it (the route-ordering ratchet in
// app-routing.module.spec.ts fails on exactly that mistake).
{path:'',component:RestaurantMgtComponent,canActivate:[AuthGuard],data:{roles:['restaurant_staff']},loadChildren: () => import('./restaurant-mgt/restaurant-mgt.module').then(m => m.RestaurantMgtModule)},
// Unreachable in practice — the portal's internal wildcard above swallows any
// unknown URL first. Kept as a safety net should the portal parent ever move.
{ path: '**', redirectTo: 'login' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
