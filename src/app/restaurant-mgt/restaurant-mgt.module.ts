import { NgModule } from '@angular/core';
import {NgxCurrencyDirective} from 'ngx-currency'
import { ColorPickerDirective } from 'ngx-color-picker';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';
import { SettingsComponent } from './settings/settings.component';
import { MenuComponent } from './menu/menu.component';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { CommonChartModule } from '../_common/common-chart/common-chart.module';
import { TablesComponent } from './tables/tables.component';
import { QRCodeComponent } from 'angularx-qrcode';
import { RestProfileComponent } from './settings/rest-profile/rest-profile.component';
import { MenuDesignComponent } from './settings/menu-design/menu-design.component';
import { OrdersComponent } from './orders/orders.component';
import { ReportsComponent } from './reports/reports.component';
import { ReportDetailComponent } from './report-detail/report-detail.component';
import { ReviewsComponent } from './reviews/reviews.component';
import { ReviewsManagementComponent } from './reviews/reviews-management.component';
import { PaymentsComponent } from './payments/payments.component';
import { RestUsersComponent } from './settings/rest-users/rest-users.component';
import { SupportComponent } from './support/support.component';
import { BillingComponent } from './settings/billing/billing.component';
import { RestNotificationsComponent } from './rest-notifications/rest-notifications.component';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { TopNavComponent } from './layout/top-nav/top-nav.component';

const routes: Routes = [
  {path: "", redirectTo: "dashboard", pathMatch: "full"},
  {path:'dashboard',component:DashboardComponent,title:'Dashboard'},
  {path:'settings',component:SettingsComponent,title:'Settings',children:[
    {path: "", redirectTo: "rest-users", pathMatch: "full"},
    {path:'restaurant-profile',component:RestProfileComponent},
    {path:'menu-design',component:MenuDesignComponent},
    {path:'rest-users',component:RestUsersComponent,title:'Users'},
    {path:'billing',component:BillingComponent,title:'Billing'},
    {path:'billing/paid/:id',component:BillingComponent,title:'Billing'}
  ]},
  {path:'menu',component:MenuComponent,title:'Menu'},
  {path:'dining-tables',component:TablesComponent,title:'Tables',children:[
    {path: "d",loadChildren: () => import('../diner-app/diner-app.module').then(m => m.DinerAppModule)},
  ] },
  
  {path:'reviews',component:ReviewsComponent,title:'Reviews'},
  {path:'reviews-management',component:ReviewsManagementComponent,title:'Reviews Management'},
  {path:'orders',component:OrdersComponent,title:'Orders'},
  {path:'payments',component:PaymentsComponent,title:'Payments'},
  {path:'reports',component:ReportsComponent,title:'Reports'}, 
  {path:'support',component:SupportComponent,title:'Support'},  
  {path:'reports/:type',component:ReportDetailComponent,title:'ReportDetail'},
  {path:'notifications',component:RestNotificationsComponent,title:'Notifications'},
  { path: 'rest-app-ordering', loadChildren: () => import('../diner-app/diner-app.module').then(m => m.DinerAppModule) }, // Load DinerApp for ordering
  { path: '**', redirectTo: '' }
  ];

@NgModule({
  declarations: [
    DashboardComponent,
    SettingsComponent,
    MenuComponent,
    TablesComponent,
    RestProfileComponent,
    MenuDesignComponent,
    OrdersComponent,
    ReportsComponent,
    ReportDetailComponent,
    RestUsersComponent,
    ReviewsComponent,
    ReviewsManagementComponent,
    SupportComponent,
    BillingComponent,
    RestNotificationsComponent,
    PaymentsComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild(routes),
    DinifyCommonModule,
    QRCodeComponent,
    ColorPickerDirective,
    NgxCurrencyDirective,
    DragDropModule,
    NgApexchartsModule,
    BaseChartDirective,
    CommonChartModule,
    SidebarComponent,
    TopNavComponent
],
  exports:[
    RouterModule
  ],
  providers: [
    provideCharts(withDefaultRegisterables()),
  ]
})
export class RestaurantMgtModule { }
