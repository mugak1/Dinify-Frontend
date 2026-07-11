import { NgModule } from '@angular/core';
import {NgxCurrencyDirective} from 'ngx-currency'
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { DashboardComponent } from './dashboard/dashboard.component';
import { RouterModule, Routes } from '@angular/router';
import { permissionGuard } from '../_helpers/permission.guard';
import { unsavedChangesGuard } from '../_helpers/unsaved-changes.guard';
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
import { ReportsShellComponent } from './reports/shell/reports-shell.component';
import { SalesReportComponent } from './reports/sales/sales-report.component';
import { MenuReportComponent } from './reports/menu/menu-report.component';
import { TransactionsReportComponent } from './reports/transactions/transactions-report.component';
import { DinersReportComponent } from './reports/diners/diners-report.component';
import { ReviewsOverviewComponent } from './reviews/overview/reviews-overview.component';
import { ReviewsFeedComponent } from './reviews/feed/reviews-feed.component';
import { TeamShellComponent } from './settings/team/team-shell.component';
import { RestUsersComponent } from './settings/team/members/rest-users.component';
import { RolesAccessComponent } from './settings/team/roles/roles-access.component';
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
import { DnSegmentedComponent } from '../_shared/ui/segmented/segmented.component';
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
import { AccountComponent } from './account/account.component';

// Per-route RBAC module gates (UX hygiene; the backend is the real boundary).
// R7 — the `settings` PARENT is intentionally NOT guarded: it has no component
// and a team/billing-only user must reach those children, so each LEAF is gated
// instead. R3 — `reports` is guarded on the PARENT only (children inherit).
// R2 — `reviews/feed` is a SIBLING route, so it carries its own guard.
const routes: Routes = [
  {path: "", redirectTo: "dashboard", pathMatch: "full"},
  {path:'dashboard',component:DashboardComponent,title:'Dashboard',canActivate:[permissionGuard],data:{module:'dashboard'}},
  {path:'settings',title:'Settings',children:[
    {path: "", component: SettingsHubComponent, pathMatch: "full",canActivate:[permissionGuard],data:{module:'settings'}},
    {path:'restaurant',component:IdentityComponent,title:'Restaurant identity & branding',canActivate:[permissionGuard],canDeactivate:[unsavedChangesGuard],data:{module:'settings'}},
    {path:'availability',component:AvailabilityComponent,title:'Availability',canActivate:[permissionGuard],canDeactivate:[unsavedChangesGuard],data:{module:'settings'}},
    {path:'team',component:TeamShellComponent,title:'Team',canActivate:[permissionGuard],data:{module:'team'},children:[
      {path:'',redirectTo:'members',pathMatch:'full'},
      {path:'members',component:RestUsersComponent,title:'Members'},
      {path:'roles',component:RolesAccessComponent,title:'Roles & access'},
    ]},
    {path:'tax-receipts',component:TaxReceiptsComponent,title:'Tax & receipts',canActivate:[permissionGuard],canDeactivate:[unsavedChangesGuard],data:{module:'settings'}},
    {path:'billing',component:BillingComponent,title:'Billing',canActivate:[permissionGuard],data:{module:'billing'}},
    {path:'billing/paid/:id',component:BillingComponent,title:'Billing',canActivate:[permissionGuard],data:{module:'billing'}},
    {path:'preset-tags',component:PresetTagsComponent,title:'Preset tags',canActivate:[permissionGuard],data:{module:'settings'}},
    {path:'account',component:AccountSecurityComponent,title:'Account & security',canActivate:[permissionGuard],canDeactivate:[unsavedChangesGuard],data:{module:'settings'}},
  ]},
  {path:'menu',component:MenuComponent,title:'Menu',canActivate:[permissionGuard],data:{module:'menu'}},
  {path:'dining-tables',component:TablesComponent,title:'Tables',canActivate:[permissionGuard],data:{module:'tables'}},
  {path:'account',component:AccountComponent,title:'My account'},

  {path:'reviews',component:ReviewsOverviewComponent,title:'Reviews',canActivate:[permissionGuard],data:{module:'reviews'}},
  {path:'reviews/feed',component:ReviewsFeedComponent,title:'Reviews',canActivate:[permissionGuard],data:{module:'reviews'}},
  {path:'reports',component:ReportsShellComponent,title:'Reports',canActivate:[permissionGuard],data:{module:'reports'},children:[
    {path: "", redirectTo: "sales", pathMatch: "full"},
    {path:'sales',component:SalesReportComponent,title:'Sales'},
    {path:'menu',component:MenuReportComponent,title:'Menu performance'},
    {path:'transactions',component:TransactionsReportComponent,title:'Transactions'},
    {path:'diners',component:DinersReportComponent,title:'Diners'},
  ]},
  {path:'support',component:SupportComponent,title:'Support'},
  {path:'notifications',component:RestNotificationsComponent,title:'Notifications'},
  { path: 'rest-app-ordering', loadChildren: () => import('../diner-app/diner-app.module').then(m => m.DinerAppModule) }, // Load DinerApp for ordering
  { path: '**', redirectTo: '' }
  ];

@NgModule({
  declarations: [
    DashboardComponent,
    MenuComponent,
    SupportComponent,
    BillingComponent,
    RestNotificationsComponent
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
    DnSegmentedComponent,
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
    TeamShellComponent,
    RolesAccessComponent,
    AccountSecurityComponent,
    AccountComponent,
    ReviewsOverviewComponent,
    ReviewsFeedComponent,
    ReportsShellComponent,
    SalesReportComponent,
    MenuReportComponent,
    TransactionsReportComponent,
    DinersReportComponent,
],
  exports:[
    RouterModule
  ],
  providers: [
    provideCharts(withDefaultRegisterables()),
  ]
})
export class RestaurantMgtModule { }
