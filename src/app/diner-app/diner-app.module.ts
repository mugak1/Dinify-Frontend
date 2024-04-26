import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BasketComponent } from './basket/basket.component';
import { MenuComponent } from './menu/menu.component';
import { HomeComponent } from './home/home.component';
import { RouterModule, Routes } from '@angular/router';
import { StorageModule } from '../_services/storage/storage.module';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { MenuItemDetailComponent } from './menu-item-detail/menu-item-detail.component';
const routes: Routes = [

  {path: "h/:id",component:HomeComponent,title:'Home' /* redirectTo: "home", pathMatch: "prefix" */},
/*   {path:'home/:id',component:HomeComponent,title:'Home'}, */
  {path:'menu',component:MenuComponent,title:'Menu'},
  {path:'menu-item/:id',component:MenuItemDetailComponent},
  {path:'basket',component:BasketComponent,title:'Tables'},
  { path: '**', redirectTo: '' }
  ];

/* @NgModule({
  declarations: [
    DashboardComponent,
    SettingsComponent,
    MenuComponent,
    TablesComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule.forChild(routes),
    NgApexchartsModule,
    DinifyCommonModule,
    QRCodeModule
  ],
  exports:[
    RouterModule    
  ]
}) */
export class RestaurantMgtModule { }


@NgModule({
  declarations: [
    MenuComponent,
    HomeComponent,
    BasketComponent,
    MenuItemDetailComponent
  ],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    StorageModule.forRoot({
      prefix:'dinify-diner-app'
    }),
    DinifyCommonModule
  ],
  exports:[
    RouterModule
  ]
})
export class DinerAppModule { }
