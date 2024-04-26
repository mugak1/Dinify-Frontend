import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RestaurantsComponent } from './restaurants/restaurants.component';
import { ReportsComponent } from './reports/reports.component';
import { PaymentsComponent } from './payments/payments.component';
import { Router, RouterModule, Routes } from '@angular/router';
import { NgApexchartsModule } from 'ng-apexcharts';
import { ReactiveFormsModule } from '@angular/forms';
import { RestaurantMgtModule } from '../restaurant-mgt/restaurant-mgt.module';
import { RestaurantMgtComponent } from '../restaurant-mgt/restaurant-mgt.component';
import { CommonImageComponent } from '../_common/common-image/common-image.component';
import { DinifyCommonModule } from '../_common/dinify-common.module';
const routes: Routes = [
  {path: "", redirectTo: "dashboard", pathMatch: "full"},
  {path:'dashboard',component:DashboardComponent,title:'Dashboard'},
  {path:'restaurants',component:RestaurantsComponent, title:'Restaurants',children:[
    {path:'rest-app/:id',component:RestaurantMgtComponent,data:{role:''},loadChildren: () => import('../restaurant-mgt/restaurant-mgt.module').then(m => m.RestaurantMgtModule)}
  ]},
  {path:'reports',component:ReportsComponent, title:'Reports'},
  {path:'payments',component:PaymentsComponent,title:'Payments'},
  { path: '**', redirectTo: '' }
  ];


@NgModule({
  declarations: [
    DashboardComponent,
    RestaurantsComponent,
    ReportsComponent,
    PaymentsComponent,
    RestaurantMgtComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule.forChild(routes),
    NgApexchartsModule,
    DinifyCommonModule
  ],
  exports:[
    RouterModule
    
  ]
})
export class DinifyMgtModule { }
