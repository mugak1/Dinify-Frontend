import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BasketComponent } from './basket/basket.component';
import { BasketBodyComponent } from './basket/basket-body/basket-body.component';
import { DinersMenuComponent } from './menu/menu.component';
import { RouterModule, Routes } from '@angular/router';
import { StorageModule } from '../_services/storage/storage.module';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { MenuItemDetailComponent } from './menu-item-detail/menu-item-detail.component';
import { OrdersComponent } from './orders/orders.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { PaymentDetailsComponent } from './payment-details/payment-details.component';
import { OrderCompleteComponent } from './order-complete/order-complete.component';
import { NgxCurrencyDirective } from 'ngx-currency';
import { ErrorPageComponent } from "./error-page/error-page.component";
import { MenuNavBarComponent } from './menu/menu-nav-bar/menu-nav-bar.component';
import { FeaturedCarouselComponent } from '../_shared/ui/featured-carousel/featured-carousel.component';
const routes: Routes = [
  {path: "h/:table",component:DinersMenuComponent,title:'Menu' /* redirectTo: "home", pathMatch: "prefix" */},
  {path:'menu',component:DinersMenuComponent,title:'Menu'},
  {path:'menu-item/:id',component:MenuItemDetailComponent},
  {path:'basket',component:BasketComponent,title:'Basket'},
  {path:'basket/order-complete',component:OrderCompleteComponent},
  {path:'orders',component:OrdersComponent},
  {path:'error',component:ErrorPageComponent},
  {path:'payment-details/:id', component:PaymentDetailsComponent},
  { path: '**', redirectTo: '' }
  ];

@NgModule({
  declarations: [
    DinersMenuComponent,
    BasketComponent,
    MenuItemDetailComponent,
    OrdersComponent,
    PaymentDetailsComponent,
    OrderCompleteComponent
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
    ErrorPageComponent,
    BasketBodyComponent,
    MenuNavBarComponent,
    FeaturedCarouselComponent
],
  exports:[
    RouterModule,
    DinersMenuComponent
  ]
})
export class DinerAppModule { }
