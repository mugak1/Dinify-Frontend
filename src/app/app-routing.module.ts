import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RestaurantMgtComponent } from './restaurant-mgt/restaurant-mgt.component';
import { DinifyMgtComponent } from './dinify-mgt/dinify-mgt.component';
import { LoginComponent } from './auth/login/login.component';
import { RegisterComponent } from './auth/register/register.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { ChangePasswordComponent } from './auth/change-password/change-password.component';
import { AuthGuard } from './_helpers/auth.guard';
import { DinerAppComponent } from './diner-app/diner-app.component';

const routes: Routes = [
{path:'login', component:LoginComponent,title:'Login'},
{path:'register',component:RegisterComponent, title:'Register'},
{path:'forgot-password',component:ForgotPasswordComponent, title:'Forgot Password'},
{path:'change-password',component:ChangePasswordComponent},
{path:'rest-app',component:RestaurantMgtComponent,canActivate:[AuthGuard],data:{role:''},loadChildren: () => import('./restaurant-mgt/restaurant-mgt.module').then(m => m.RestaurantMgtModule)},
{path:'mgt-app',component:DinifyMgtComponent,canActivate:[AuthGuard],data:{role:''},loadChildren: () => import('./dinify-mgt/dinify-mgt.module').then(m => m.DinifyMgtModule)},
{path:'diner',component:DinerAppComponent,loadChildren:()=> import('./diner-app/diner-app.module').then(m=>m.DinerAppModule)},
    // otherwise redirect to home
{ path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
