import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BasketComponent } from './basket/basket.component';
import { DinersMenuComponent } from './menu/menu.component';
import { HomeComponent } from './home/home.component';
import { RouterModule, Routes } from '@angular/router';
import { StorageModule } from '../_services/storage/storage.module';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { MenuItemDetailComponent } from './menu-item-detail/menu-item-detail.component';
import { OrdersComponent } from './orders/orders.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PaymentDetailsComponent } from './payment-details/payment-details.component';
import { ScrollSpyDirective } from './scroll-spy.directive';
import { OrderCompleteComponent } from './order-complete/order-complete.component';
import { CurrencyModule } from '../_common/currency-input/currency-input.module';
import { NgxCurrencyDirective } from 'ngx-currency';
import { ErrorPageComponent } from "./error-page/error-page.component";
const routes: Routes = [
  {path: "h/:table",component:HomeComponent,title:'Home' /* redirectTo: "home", pathMatch: "prefix" */},
/*   {path:'home/:id',component:HomeComponent,title:'Home'}, */
  {path:'menu',component:DinersMenuComponent,title:'Menu'},
  {path:'menu-item/:id',component:MenuItemDetailComponent},
  {path:'menu/basket',component:BasketComponent,title:'Basket'},
  {path:'menu/error',component:ErrorPageComponent},
  {path:'menu/basket/order-complete',component:OrderCompleteComponent},
  {path:'basket',component:BasketComponent,title:'Basket'},
  {path:'basket/order-complete',component:OrderCompleteComponent},
  {path:'orders',component:OrdersComponent},
  {path:'order-complete',component:OrderCompleteComponent},
  {path:'error',component:ErrorPageComponent},
  {path:'payment-details/:id', component:PaymentDetailsComponent},
  { path: '**', redirectTo: '' }
  ];


@NgModule({
  declarations: [
    DinersMenuComponent,
    HomeComponent,
    BasketComponent,
    MenuItemDetailComponent,
    OrdersComponent,
    PaymentDetailsComponent,
    ScrollSpyDirective
  ],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    ReactiveFormsModule,
    StorageModule.forRoot({
        prefix: 'dinify-diner-app'
    }),
    DinifyCommonModule,
    NgxCurrencyDirective,
    FormsModule,
    ErrorPageComponent
],
  exports:[
    RouterModule,
    DinersMenuComponent
  ]
})
export class DinerAppModule { }
