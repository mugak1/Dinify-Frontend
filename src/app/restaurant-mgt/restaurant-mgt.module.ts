import { NgModule } from '@angular/core';
import {NgxCurrencyDirective} from 'ngx-currency'
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TrendIndicatorComponent } from './dashboard/components/trend-indicator/trend-indicator.component';
import { AnimatedNumberComponent } from './dashboard/components/animated-number/animated-number.component';
import { CardSkeletonComponent } from './dashboard/components/card-skeleton/card-skeleton.component';
import { CardErrorComponent } from './dashboard/components/card-error/card-error.component';
import { RevenueCardComponent } from './dashboard/components/revenue-card/revenue-card.component';
import { PaymentMethodsCardComponent } from './dashboard/components/payment-methods-card/payment-methods-card.component';
import { PopularItemsCardComponent } from './dashboard/components/popular-items-card/popular-items-card.component';
import { TotalOrdersCardComponent } from './dashboard/components/total-orders-card/total-orders-card.component';
import { TablesCardComponent } from './dashboard/components/tables-card/tables-card.component';
import { KdsAttentionCardComponent } from './dashboard/components/kds-attention-card/kds-attention-card.component';
import { ReviewsCardComponent } from './dashboard/components/reviews-card/reviews-card.component';
import { MenuComponent } from './menu/menu.component';
import { DinifyCommonModule } from '../_common/dinify-common.module';
import { CommonChartModule } from '../_common/common-chart/common-chart.module';
import { TablesComponent } from './tables/tables.component';
import { QRCodeComponent } from 'angularx-qrcode';
import { IdentityComponent } from './settings/identity/identity.component';
import { AvailabilityComponent } from './settings/availability/availability.component';
import { TaxReceiptsComponent } from './settings/tax-receipts/tax-receipts.component';
import { ReportsComponent } from './reports/reports.component';
import { ReportDetailComponent } from './report-detail/report-detail.component';
import { ReviewsComponent } from './reviews/reviews.component';
import { ReviewsManagementComponent } from './reviews/reviews-management.component';
import { ReviewsOverviewComponent } from './reviews/overview/reviews-overview.component';
import { ReviewsFeedComponent } from './reviews/feed/reviews-feed.component';
import { PaymentsComponent } from './payments/payments.component';
import { RestUsersComponent } from './settings/rest-users/rest-users.component';
import { SupportComponent } from './support/support.component';
import { BillingComponent } from './settings/billing/billing.component';
import { RestNotificationsComponent } from './rest-notifications/rest-notifications.component';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { TopNavComponent } from './layout/top-nav/top-nav.component';
import { SectionRailComponent } from './menu/components/section-rail/section-rail.component';
import { ItemCardComponent } from './menu/components/item-card/item-card.component';
import { ItemListComponent } from './menu/components/item-list/item-list.component';
import { SectionFormDialogComponent } from './menu/components/section-form-dialog/section-form-dialog.component';
import { ItemFormDialogComponent } from './menu/components/item-form-dialog/item-form-dialog.component';
import { MenuSearchComponent } from './menu/components/menu-search/menu-search.component';
import { StorageModule } from '../_services/storage/storage.module';
import { UpsellsTabComponent } from './menu/components/upsells-tab/upsells-tab.component';
import { ItemDetailViewComponent } from './menu/components/item-detail-view/item-detail-view.component';
import { TabsComponent, TabListComponent, TabTriggerComponent, TabContentComponent } from '../_shared/ui/tabs/tabs.component';
import { TagFilterSheetComponent } from './menu/components/tag-filter-sheet/tag-filter-sheet.component';
import { UpsellCarouselComponent } from './menu/components/upsell-carousel/upsell-carousel.component';
import { PreviewMenuDrawerComponent } from './menu/components/preview-menu-drawer/preview-menu-drawer.component';
import { DialogComponent } from '../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../_shared/ui/button/button.component';
import { CardComponent } from '../_shared/ui/card/card.component';
import { BadgeComponent } from '../_shared/ui/badge/badge.component';
import { SheetComponent } from '../_shared/ui/sheet/sheet.component';
import { PresetTagsComponent } from './settings/preset-tags/preset-tags.component';
import { SettingsHubComponent } from './settings/settings-hub/settings-hub.component';
import { SectionPageComponent } from './settings/components/section-page/section-page.component';
import { SettingsIconComponent } from './settings/components/settings-icon/settings-icon.component';
import { AccountSecurityComponent } from './settings/account-security/account-security.component';

const routes: Routes = [
  {path: "", redirectTo: "dashboard", pathMatch: "full"},
  {path:'dashboard',component:DashboardComponent,title:'Dashboard'},
  {path:'settings',title:'Settings',children:[
    {path: "", component: SettingsHubComponent, pathMatch: "full"},
    {path:'restaurant',component:IdentityComponent,title:'Restaurant identity & branding'},
    {path:'availability',component:AvailabilityComponent,title:'Availability'},
    {path:'rest-users',component:RestUsersComponent,title:'Staff & roles'},
    {path:'tax-receipts',component:TaxReceiptsComponent,title:'Tax & receipts'},
    {path:'billing',component:BillingComponent,title:'Billing'},
    {path:'billing/paid/:id',component:BillingComponent,title:'Billing'},
    {path:'preset-tags',component:PresetTagsComponent,title:'Preset tags'},
    {path:'account',component:AccountSecurityComponent,title:'Account & security'},
  ]},
  {path:'menu',component:MenuComponent,title:'Menu'},
  {path:'dining-tables',component:TablesComponent,title:'Tables'},
  
  {path:'reviews',component:ReviewsOverviewComponent,title:'Reviews'},
  {path:'reviews/feed',component:ReviewsFeedComponent,title:'Reviews'},
  {path:'reviews-management',component:ReviewsManagementComponent,title:'Reviews Management'},
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
    MenuComponent,
    ReportsComponent,
    ReportDetailComponent,
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
    NgxCurrencyDirective,
    DragDropModule,
    BaseChartDirective,
    TrendIndicatorComponent,
    AnimatedNumberComponent,
    CardSkeletonComponent,
    CardErrorComponent,
    RevenueCardComponent,
    PaymentMethodsCardComponent,
    PopularItemsCardComponent,
    TotalOrdersCardComponent,
    TablesCardComponent,
    KdsAttentionCardComponent,
    ReviewsCardComponent,
    CommonChartModule,
    SidebarComponent,
    TopNavComponent,
    SectionRailComponent,
    ItemCardComponent,
    ItemListComponent,
    SectionFormDialogComponent,
    ItemFormDialogComponent,
    MenuSearchComponent,
    StorageModule.forRoot({ prefix: 'dinify-restaurant-mgt' }),
    UpsellsTabComponent,
    ItemDetailViewComponent,
    TabsComponent,
    TabListComponent,
    TabTriggerComponent,
    TabContentComponent,
    TagFilterSheetComponent,
    UpsellCarouselComponent,
    PreviewMenuDrawerComponent,
    DialogComponent,
    ButtonComponent,
    CardComponent,
    BadgeComponent,
    SheetComponent,
    TablesComponent,
    PresetTagsComponent,
    SettingsHubComponent,
    SectionPageComponent,
    SettingsIconComponent,
    IdentityComponent,
    AvailabilityComponent,
    TaxReceiptsComponent,
    RestUsersComponent,
    AccountSecurityComponent,
    ReviewsOverviewComponent,
    ReviewsFeedComponent,
],
  exports:[
    RouterModule
  ],
  providers: [
    provideCharts(withDefaultRegisterables()),
  ]
})
export class RestaurantMgtModule { }
