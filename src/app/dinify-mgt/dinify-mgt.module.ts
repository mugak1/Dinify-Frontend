import { NgModule } from '@angular/core';

import { NgxIntlTelephoneInputModule } from "ngx-intl-telephone-input";
import {NgxCurrencyDirective} from 'ngx-currency'
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RestaurantsComponent } from './restaurants/restaurants.component';
import { ReportsComponent } from './reports/reports.component';
import { PaymentsComponent } from './payments/payments.component';
import { RouterModule, Routes } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RestaurantMgtComponent } from '../restaurant-mgt/restaurant-mgt.component';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { MgtNotificationsComponent } from './mgt-notifications/mgt-notifications.component';
import { MgtSupportComponent } from './mgt-support/mgt-support.component';
const routes: Routes = [
  {path: "", redirectTo: "dashboard", pathMatch: "full"},
  {path:'dashboard',component:DashboardComponent,title:'Dashboard'},
  {path:'restaurants',component:RestaurantsComponent, title:'Restaurants',children:[
    {path:'rest-app/:id',component:RestaurantMgtComponent,data:{role:''},loadChildren: () => import('../restaurant-mgt/restaurant-mgt.module').then(m => m.RestaurantMgtModule)}
  ]},
  {path:'reports',component:ReportsComponent, title:'Reports'},
  {path:'payments',component:PaymentsComponent,title:'Payments'},
  {path:'notifications',component:MgtNotificationsComponent,title:'Notifications'},
  {path:'support',component:MgtSupportComponent,title:'Support'},
  { path: '**', redirectTo: '' }
  ];


@NgModule({
  declarations: [
    DashboardComponent,
    RestaurantsComponent,
    ReportsComponent,
    PaymentsComponent,
    RestaurantMgtComponent,
    MgtNotificationsComponent,
    MgtSupportComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild(routes),
    NgApexchartsModule,
    DinifyCommonModule,
    NgxIntlTelephoneInputModule,
    NgxCurrencyDirective
  ],
  exports:[
    RouterModule
    
  ]
})
export class DinifyMgtModule { }
