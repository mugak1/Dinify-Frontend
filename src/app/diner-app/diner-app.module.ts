import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BasketComponent } from './basket/basket.component';
import { BasketBodyComponent } from './basket/basket-body/basket-body.component';
import { DinersMenuComponent } from './menu/menu.component';
import { RouterModule, Routes } from '@angular/router';
import { StorageModule } from '../_services/storage/storage.module';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { MenuItemDetailComponent } from './menu-item-detail/menu-item-detail.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { OrderCompleteComponent } from './order-complete/order-complete.component';
import { ErrorPageComponent } from "./error-page/error-page.component";
import { DinerConnectionErrorComponent } from './connection-error/connection-error.component';
import { MenuNavBarComponent } from './menu/menu-nav-bar/menu-nav-bar.component';
import { FeaturedCarouselComponent } from '../_shared/ui/featured-carousel/featured-carousel.component';
import { DinerTagFilterSheetComponent } from './menu/diner-tag-filter-sheet/diner-tag-filter-sheet.component';
import { TagPillComponent } from '../_shared/tags/tag-pill.component';
import { TagOverflowPillComponent } from '../_shared/tags/tag-overflow-pill.component';
import { HighlightPipe } from 'src/app/_shared/ui/highlight.pipe';
import { PriceDisplayComponent } from '../_shared/ui/price-display/price-display.component';
import { DiscountBadgeComponent } from '../_shared/ui/discount-badge/discount-badge.component';
import { SavingsIndicatorComponent } from '../_shared/ui/savings-indicator/savings-indicator.component';
import { MenuDishCardComponent } from '../_shared/ui/menu-dish-card/menu-dish-card.component';
import { ModifierGroupsSelectorComponent } from '../_shared/ui/modifier-groups-selector/modifier-groups-selector.component';
import { ExtrasSelectorComponent } from '../_shared/ui/extras-selector/extras-selector.component';
import { StarRatingComponent } from './order-complete/star-rating.component';
import { OngoingOrderBannerComponent } from './ongoing-order-banner/ongoing-order-banner.component';
import { ButtonComponent } from '../_shared/ui/button/button.component';
import { AllergenDisclaimerComponent } from '../_shared/ui/allergen-disclaimer/allergen-disclaimer.component';
const routes: Routes = [
  {path: "h/:table",component:DinersMenuComponent,title:'Menu' /* redirectTo: "home", pathMatch: "prefix" */},
  {path:'menu',component:DinersMenuComponent,title:'Menu'},
  {path:'basket',component:BasketComponent,title:'Basket'},
  {path:'basket/order-complete',component:OrderCompleteComponent,title:'Order placed'},
  {path:'error',component:ErrorPageComponent},
  // RETIRED (D07). `payment-details/:id` rendered "Your payment of UGX X was
  // successfully received" from a `transaction_status` nothing in the platform
  // can produce: the order-payment write path was retired in the non-custodial
  // teardown and the only surviving writer (`tx_subscription`) is record-only
  // and now refuses outright (501). It was orphaned from navigation — no
  // routerLink, no navigate(), and no backend redirect or provider callback
  // names it — but it was LIVE as a deep link on BOTH diner mounts, so this is
  // the removal of a reachable route rather than of dead code. A bookmarked URL
  // now falls to the wildcard below and lands on the menu.
  //
  // The BACKEND route it read (`orders/journey/payment-details/`) is untouched,
  // and its entry in `_security/diner-capability-contract.ts` deliberately
  // STAYS: that allowlist describes the server's surface for cross-repo parity,
  // not this app's navigation.
  { path: 'h/:table/item/:itemId', component: MenuItemDetailComponent, title: 'Menu' },
  { path: '**', redirectTo: '' }
  ];

@NgModule({
  declarations: [
    DinersMenuComponent,
    BasketComponent,
    MenuItemDetailComponent,
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
    FormsModule,
    ErrorPageComponent,
    DinerConnectionErrorComponent,
    BasketBodyComponent,
    MenuNavBarComponent,
    FeaturedCarouselComponent,
    DinerTagFilterSheetComponent,
    TagPillComponent,
    TagOverflowPillComponent,
    HighlightPipe,
    PriceDisplayComponent,
    DiscountBadgeComponent,
    SavingsIndicatorComponent,
    MenuDishCardComponent,
    ModifierGroupsSelectorComponent,
    ExtrasSelectorComponent,
    StarRatingComponent,
    OngoingOrderBannerComponent,
    ButtonComponent,
    AllergenDisclaimerComponent
],
  exports:[
    RouterModule,
    DinersMenuComponent
  ]
})
export class DinerAppModule { }
