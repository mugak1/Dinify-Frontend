import { NgModule } from '@angular/core';
import { ColorPickerModule } from 'ngx-color-picker';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RouterModule, Routes } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { NgApexchartsModule } from 'ng-apexcharts';
import { SettingsComponent } from './settings/settings.component';
import { MenuComponent } from './menu/menu.component';
import { CommonImageComponent } from '../_common/common-image/common-image.component';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { TablesComponent } from './tables/tables.component';
import { QRCodeModule } from 'angularx-qrcode';
import { RestProfileComponent } from './settings/rest-profile/rest-profile.component';
import { MenuDesignComponent } from './settings/menu-design/menu-design.component';

const routes: Routes = [
  {path: "", redirectTo: "dashboard", pathMatch: "full"},
  {path:'dashboard',component:DashboardComponent,title:'Dashboard'},
  {path:'settings',component:SettingsComponent,title:'Settings',children:[
    {path: "", redirectTo: "restaurant-profile", pathMatch: "full"},
    {path:'restaurant-profile',component:RestProfileComponent},
    {path:'menu-design',component:MenuDesignComponent}
  ]},
  {path:'menu',component:MenuComponent,title:'Menu'},
  {path:'tables',component:TablesComponent,title:'Tables'},
  { path: '**', redirectTo: '' }
  ];

@NgModule({
  declarations: [
    DashboardComponent,
    SettingsComponent,
    MenuComponent,
    TablesComponent,
    RestProfileComponent,
    MenuDesignComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule.forChild(routes),
    NgApexchartsModule,
    DinifyCommonModule,
    QRCodeModule,
    ColorPickerModule
  ],
  exports:[
    RouterModule    
  ]
})
export class RestaurantMgtModule { }
