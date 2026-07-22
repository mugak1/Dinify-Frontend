import { NgModule } from '@angular/core';

import {NgxCurrencyDirective} from 'ngx-currency'
import { DinifyPhoneInputComponent } from '../shared/dinify-phone-input/dinify-phone-input.component';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RestaurantsComponent } from './restaurants/restaurants.component';
import { ReportsComponent } from './reports/reports.component';
import { PaymentsComponent } from './payments/payments.component';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RestaurantMgtComponent } from '../restaurant-mgt/restaurant-mgt.component';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { MgtNotificationsComponent } from './mgt-notifications/mgt-notifications.component';
import { MgtSupportComponent } from './mgt-support/mgt-support.component';
import { SidebarComponent } from '../restaurant-mgt/layout/sidebar/sidebar.component';
import { TopNavComponent } from '../restaurant-mgt/layout/top-nav/top-nav.component';
import { CardComponent, BadgeComponent, ButtonComponent, DialogComponent, OfflineBannerComponent } from '../_shared/ui';
import { LucideAngularModule, LayoutDashboard, UtensilsCrossed, ClipboardList, Grid3x3, Star, ChartBar, CreditCard, LifeBuoy, Settings, ChevronLeft, ChevronRight, Menu, X, Bell } from 'lucide-angular';
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
    MgtNotificationsComponent,
    MgtSupportComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild(routes),
    DinifyCommonModule,
    DinifyPhoneInputComponent,
    NgxCurrencyDirective,
    SidebarComponent,
    TopNavComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    DialogComponent,
    OfflineBannerComponent,
    LucideAngularModule.pick({ LayoutDashboard, UtensilsCrossed, ClipboardList, Grid3x3, Star, ChartBar, CreditCard, LifeBuoy, Settings, ChevronLeft, ChevronRight, Menu, X, Bell })
  ],
  exports:[
    RouterModule
    
  ]
})
export class DinifyMgtModule { }
