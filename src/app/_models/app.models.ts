import { BehaviorSubject } from "rxjs";

export interface ApiResponse<T>{
    message:string;
    status:number;
    data?:Data<T>;
    error?:{status:number,message:string,token:string,first_name?:string,last_name?:string}
    pagination: Pagination;
    
  }
  export interface Data<T>{
    records: T[]
    pagination: Pagination
  }
  export interface Pagination {
    number_of_pages: number;
    current_page: number;
    total_records: number;
    records_per_page: number;
    has_next: boolean;
    has_previous: boolean;
  }
export interface LoginResponse {
  token: string
  refresh: string
  profile: Profile
  require_otp:boolean
  prompt_password_change:boolean
}
export interface OTPResponse {
  valid: boolean
  token: string
  refresh: string
}

export interface Profile {
  id: string
  first_name: string
  last_name: string
  email: string
  roles: string[]
  other_names: any
  phone_number:any;
  restaurant_roles: RestaurantRole[]
}
export interface RestaurantRole {
  restaurant_id: string
  restaurant: string
  roles: string[]
}
export interface ConfirmaDialogData {
  title?: string; //confirmation dialog title
  titleTooltip?: string; //tooltip for title if needed
  icon?: string; //dialog icon
  message?: string; // confirmation dialog subtitle
  cancelButtonText?: string; //cancel button text
  submitButtonText?: string; //submit button text
  type?:string; //confirmation, info
  isInfoActionable?:boolean; //on hover list show info dialog
  data?: any[]; //processed data for showing custom info ...etc
  submitButtonStatus?:boolean; //hide/show submit button
  cancelButtonStatus?:boolean; //hide/show cancel button
  width?:string; //popup width
  height?:string; //popup width
  callback?:BehaviorSubject<any>
  has_reason?:boolean;
  reason?:any;
  reason_required?:boolean
  action_info?:any;
}
export interface RestaurantList {
  id: string
  name: string
  location: string
  logo: string
  status:string
  owner:User
}
export interface User {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  phone_number: string
}
export type ScheduleDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SectionSchedule {
  id: string;
  days: ScheduleDay[];
  startTime: string;
  endTime: string;
}

export interface MenuSectionListItem {
  id: string
  name: string
  description: string
  section_banner_image: any
  available: boolean
  item_count:number
  has_groups:boolean
  groups:[{id:any,name:string,items:MenuItem[]}],
  listing_position:number
  availability?: 'always' | 'scheduled'
  schedules?: SectionSchedule[]
}
export interface MenuItemGroup {
  id: string;
  name: string;
}

export interface MenuItemExtraRef {
  id: string;
  name: string;
  // DRF serialises DecimalField as a string; matches primary_price below.
  primary_price: string;
  // Discount rules for this extra — same shape as MenuItem.discount_details.
  // Optional: legacy/cached payloads predate it; absent or {} ⇒ no discount.
  // The effective price is recomputed client-side via getCurrentPriceFromDetails,
  // mirroring how the parent item's price is derived.
  discount_details?: DiscountDetails | null;
}

/**
 * Embedded tag object on a MenuItem — matches the shape returned by
 * SerializerPublicGetMenuItem.get_tags(): {id, name, category, icon, colour}.
 * This is the subset of RestaurantTag carried on the item, not the full
 * catalog row (no filterable / display_order / is_system_preset).
 */
export interface MenuItemTagRef {
  id: string;
  name: string;
  category: 'allergen' | 'dietary' | 'descriptor';
  icon: string | null;
  colour: string;
}

/**
 * Faithful shape of restaurants_app.serializers.SerializerPublicGetMenuItem.
 * Decimal fields are strings (DRF default); section is a UUID FK string.
 */
export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  calories: number | null;
  primary_price: string;
  discounted_price: string | null;
  running_discount: boolean;
  image: string | null;
  section: string;
  group: MenuItemGroup | null;
  available: boolean;
  in_stock: boolean;
  is_extra: boolean;
  is_special: boolean;
  is_featured: boolean;
  is_popular: boolean;
  is_new: boolean;
  age_restricted?: boolean;
  extras_min_selections?: number;
  extras_max_selections?: number | null;
  has_options: boolean;
  options: ItemModifiers;
  has_extras: boolean;
  extras: MenuItemExtraRef[];
  tags: MenuItemTagRef[];
  allergens: string[];
  discount_details: DiscountDetails | null;
  discount_percentage: number;
}

export interface ModifierChoice {
  id: string;
  name: string;
  additionalCost: number;
  available: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  selectionType: 'single' | 'multiple';
  minSelections: number;
  maxSelections: number;
  choices: ModifierChoice[];
}

export interface ItemModifiers {
  hasModifiers: boolean;
  groups: ModifierGroup[];
}

/**
 * Canonical discount_details shape — must match restaurants_app/models.py:234-242.
 * discount_percentage and discount_amount are SUBTRACTION values
 * (percentage 0..100 to subtract, or UGX amount to subtract from primary_price).
 * Pre-0042 buggy keys (raw_discount_value / raw_discount_type) are migrated
 * out of all production rows and must not be reintroduced.
 */
export interface DiscountDetails {
  discount_type?: 'percentage' | 'fixed';
  discount_percentage?: number;
  discount_amount?: number;
  recurring_days?: number[];
  start_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
}

/** @deprecated Alias kept for existing imports — prefer DiscountDetails. */
export type ItemDiscountDetails = DiscountDetails;

export interface TableListItem {
  id: string
  time_created: string
  time_last_updated: string
  time_deleted: any
  deleted: boolean
  deletion_reason: any
  archived: boolean
  number: number
  room_name: any
  prepayment_required: boolean
  smoking_zone: boolean
  outdoor_seating: boolean
  available: boolean
  created_by: string
  deleted_by: any
  restaurant: string
}
export interface TableScan {
  id: string
  number: number
  room_name: any
  prepayment_required: boolean
  available: boolean
  current_order: CurrentOrder
  restaurant: Restaurant
}

export interface CurrentOrder {
  ongoing: boolean
  order_id: any
}
export interface RestaurantDetail {
  id: string
  account:Account
  time_created: string
  time_last_updated: string
  time_deleted: any
  deleted: boolean
  deletion_reason: any
  archived: boolean
  name: string
  location: string
  logo: string
  status: string
  require_order_prepayments: boolean
  expose_order_ratings: boolean
  allow_deliveries: boolean
  allow_pickups: boolean
  accepting_orders: boolean
  preferred_subscription_method: string
  order_surcharge_percentage: number
  flat_fee: number
  order_surcharge_min_amount: number
  order_surcharge_cap_amount: number
  branding_configuration: BrandingConfiguration
  tagline: string | null
  cuisine_types: string[]
  contact_phone: string | null
  contact_email: string | null
  landmark: string | null
  cover_photo: string | null
  socials: Socials
  country: string
  first_time_menu_approval: boolean
  first_time_menu_approval_decision: string
  created_by: string
  deleted_by: any
  owner: string
  subscription_validity:boolean;
  subscription_expiry_date:any;
  // Tax & receipts (settings-fields backend PR). vat_rate is a DRF DecimalField,
  // which serializes as a string (e.g. "18.00"); accept number too for safety.
  vat_registered: boolean;
  vat_rate: number | string;
  tin: string | null;
  receipt_footer: string | null;
  // Availability — opening hours (opening-hours backend PR). Object keyed by
  // lowercase full day name; one same-day interval per day. Nullable: a
  // restaurant that never configured hours returns null.
  opening_hours: OpeningHours | null;
}

/**
 * A single day's opening hours. Times are 24-hour "HH:MM" (no seconds) — the
 * native <input type="time"> value maps straight to this. Closing a day flips
 * `closed` but retains open/close so toggling back restores the hours.
 */
export interface DayHours {
  closed: boolean;
  open: string;
  close: string;
}

export type OpeningHoursDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/** Weekly opening hours, keyed by lowercase full day name. */
export type OpeningHours = Record<OpeningHoursDay, DayHours>;
export interface Restaurant {
  id: string
  name: string
  logo: string
  // Optional cover photo. Present on the table-scan `restaurant` payload but
  // omitted by older callers, hence optional. Surfaces the diner menu hero.
  cover_photo?: string | null
  menu_approval_status:any
  branding_configuration: BrandingConfiguration
  preset_tags?: any[]
}

export interface BrandingConfiguration {
  home: Home
}

// branding_configuration.home carries four keys (backend default + migration
// 0041). The Identity section edits ONLY brand_color; the other three are
// preserved verbatim on save so the diner header keeps rendering. Note:
// home.tagline is a branding key and is NOT the top-level `tagline` column.
export interface Home {
  header_style: string
  brand_color: string
  logo_display: string
  tagline: string
}

// Public-facing social handles/links. Stored as a JSON object on the
// restaurant; empty handles are sent as null (the null-clears convention).
export interface Socials {
  instagram?: string | null
  facebook?: string | null
  x?: string | null
  tiktok?: string | null
}
export interface Item {
  id: string
  name: string
  description?: string
  primary_price: number
  discounted_price: any
  running_discount: boolean
  image: string
  available: boolean
  has_options: boolean
  options: Options
  group: any
}

export interface Options {

}

  export interface BasketItem {
    itemId: string;
    itemName: string;
    image?: string;
    basePrice: number;
    totalPrice: number;
    quantity: number;
    selectedModifiers: SelectedModifier[];
    extras: any[];
    isDiscounted?: boolean;
    originalBasePrice?: number;
    discountAmount?: number;
    discountPercentage?: number;
  }

  export interface SelectedModifier {
    groupId: string;
    groupName: string;
    choices: { id: string; name: string; additionalCost: number }[];
  }

export interface ShoppingBasket {
  items: BasketItem[];
  totalAmount: number;
}
export interface OrderInitiated {
  order_details: OrderDetails
  order_items: OrderItem[]
  unavailable_items: any[]
  available_items: AvailableItem[]
  unavailable_extras: any[]
}

export interface OrderDetails {
  id: string
  restaurant: string
  table: string
  table_number: number
  total_cost: number
  discounted_cost: number
  savings: number
  actual_cost: number
  prepayment_required: boolean
  no_items: number
  no_unavailable_items: number
  no_available_items: number
  no_unavailable_extras: number
  order_status: string
  payment_status: string
}

export interface OrderItem {
  item: string
  item_name: string
  quantity: number
  unit_price: number
  discounted_price: number
  discounted: boolean
  total_cost: number
  discounted_cost: number
  savings: number
  actual_cost: number
  available: boolean
  status: string
  order: string
}

export interface AvailableItem {
  item: string
  item_name: string
  quantity: number
  unit_price: number
  discounted_price: number
  discounted: boolean
  total_cost: number
  discounted_cost: number
  savings: number
  actual_cost: number
  available: boolean
  status: string
  order: string
}
export interface OrderDetail {
  id: string
  table: string
  customer: string
  total_cost: number
  discounted_cost: number
  savings: number
  actual_cost: number
  prepayment_required: boolean
  payment_status: string
  order_status: string
  items: Item[]
  order_number: number
  time_created: string
  table_details: OrderedTableDetails
  count_items_served: number
  total_paid: string
  balance_payable: string
  time_last_updated: string
}
export interface OrdersListItem{

  total_paid: string
  balance_payable: string
  time_last_updated: string

  id: string
  table: string
  customer: any
  total_cost: number
  discounted_cost: number
  savings: number
  actual_cost: number
  prepayment_required: boolean
  payment_status: string
  order_status: string
  items: OrderedItem[]
  extras:any[]
  order_number: number
  time_created: string
  table_details: OrderedTableDetails
  count_items_served:number
  count_items_considered:number
}

export interface OrderedItem {
  id: string
  item: OrderedItemDetail
  available: boolean
  quantity: number
  unit_price: number
  discounted_price: number
  savings: number
  options: any[]
  extras:any[]
  cost_of_options: number
  actual_cost: number
  status: string
  deleted:boolean;
  deletion_reason?:string;
  time_last_updated: string
}

export interface OrderedItemDetail {
  id: string
  name: string
  is_special:boolean
}
export interface OrderedTableDetails {
  table_number: number
  table_room_name: any
}
export interface EmployeeListUser {
  id: string
  time_created: string
  time_last_updated: string
  name: string
  roles: string[]
  active: boolean
  user?: User
}
/**
 * Response from `restaurant-setup/create-employee/`. `temp_password` is the
 * one-time password the owner must hand the new member; it may arrive at the
 * top level or under `data` depending on the endpoint envelope, so it is read
 * defensively (`resp?.data?.temp_password || resp?.temp_password`), mirroring
 * the forgot-password flow. Index signatures keep the shape forgiving.
 */
export interface CreateEmployeeResponse {
  temp_password?: string
  data?: {
    temp_password?: string
    name?: string
    user?: { name?: string; email?: string;[key: string]: any }
    [key: string]: any
  }
  [key: string]: any
}
export interface ReviewListItem {
  id: string
  rating: number
  review: string
  block_review: boolean
  customer: string
  time_created:string
  order_number:number;
  showReadMore:boolean;
  isExpanded:boolean;
}
export interface NotificationItem {
  _id: string
  tos: string[]
  ccs: any[]
  subject: string
  email: string
  sms: any
  read:boolean
  creation_timestamp: NotificationTimestamp
}

export interface NotificationTimestamp {
  date: number
  month: number
  year: number
  hour: number
  minute: number
  day: string
  timestamp: string
  epoch: number
}
export interface Account {
  id: string
  time_created: string
  time_last_updated: string
  time_deleted: any
  deleted: boolean
  deletion_reason: any
  archived: boolean
  account_currency: string
  account_type: string
  account_status: string
  created_by: any
  deleted_by: any
  restaurant: string
  user: any
}
export interface TransactionListItem {
  id: string
  time_created: string
  transaction_type: string
  order_number: number
  amount_in: number
  amount_out: number
  transaction_status: string
  transaction_platform: string
}
export interface SalesReportListItem {
  id: string
  order_number: number
  no_items: number
  total_cost: number
  discounted_cost: number
  payment_mode: string
  payment_status: string
  time_created: string
  last_updated_by: string
}
// Restaurant-facing support ticketing (api/v1/support/issues/).
// Mirrors the restaurant read serializer — i.e. WITHOUT internal_notes or
// assigned_to, which are admin-only (those live on SupportIssueAdmin below,
// used by the Dinify-admin triage screen).
export type SupportCategory =
  | 'orders_kds'
  | 'menu'
  | 'tables_qr'
  | 'payments'
  | 'reports'
  | 'account'
  | 'bug'
  | 'other';
export type SupportImpact =
  | 'blocking_service'
  | 'affecting_service'
  | 'non_urgent'
  | 'question';
export type SupportIssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type PreferredContactMethod = 'whatsapp' | 'phone' | 'email';

export interface SupportIssue {
  id: string;
  reference: string;
  restaurant: string;
  restaurant_name: string;
  category: SupportCategory;
  impact: SupportImpact;
  status: SupportIssueStatus;
  title: string;
  description: string;
  contact_phone: string | null;
  contact_email: string | null;
  preferred_contact_method: PreferredContactMethod | null;
  page_url: string | null;
  user_agent: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_by_name: string;
  time_created: string;
  time_last_updated: string;
}

// Admin/triage view of a support issue (api/v1/support/admin/issues/).
// Superset of SupportIssue with the admin-only fields from the admin read
// serializer. The assign-to-user picker is deferred for v1, but assigned_to /
// assigned_to_name remain on the model for a later PR.
export interface SupportIssueAdmin extends SupportIssue {
  assigned_to: string | null;
  assigned_to_name: string | null;
  internal_notes: string | null;
  created_by: string;
}
export interface SalesTrendListItem {
  number_of_sales: number
  gross_sales_amount: number
  sales_by_payment_channel: any
  sales_amount_by_payment_channel: any
  average_order_amount: number
  maximum_order_amount: number
  minimum_order_amount: number
  total_discounts_offered: number
  date: string
  month:string
  year:string
}
export interface RatingSummary {
  total_ratings: number
  one_star_percent: number
  two_star_percent: number
  three_star_percent: number
  four_star_percent: number
  five_star_percent: number
  average_rating: number
}
export interface ChartData {
  series: Series[]
  xaxis: Xaxis
}

export interface Series {
  name: string
  data: number[]
}

export interface Xaxis {
  categories: string[]
  title: Title
}

export interface Title {
  text: string
}
export interface DinifyDashboardData {
  stats: Stats
  trend: Trend
}

export interface Stats {
  restaurant_summary: RestaurantSummary
  orders_summary: OrdersSummary
  users_summary: UsersSummary
  dinify_earnings: DinifyEarnings
  top_restaurants: TopRestaurant[]
}

export interface RestaurantSummary {
  total: number
  monthly: number
  month_growth: string
  status_breakdown: StatusBreakdown
}

export interface StatusBreakdown {
  pending: number
  active: number
  inactive: number
  blocked: number
  rejected: number
}

export interface OrdersSummary {
  total: number
  monthly: number
  month_growth: string
  status_breakdown: StatusBreakdown2
}

export interface StatusBreakdown2 {
  closed: number
  open: number
}

export interface UsersSummary {
  total: number
  monthly: number
  month_growth: string
  dinify_staff: number
  restaurant_staff: number
  diners: number
}

export interface DinifyEarnings {
  total: number
  monthly: number
  month_growth: string
  subscriptions: number
  outstanding: number
}

export interface TopRestaurant {
  restaurant: string
  orders: number
  amount?: number
}

export interface Trend {
  series: Series[]
  xaxis: Xaxis
}

export interface Series {
  name: string
  data: number[]
}
export interface RestaurantDashboardData {
  revenue: Revenue
  orders: Orders
}

export interface Revenue {
  total: number
  this_month: number
  month_growth: string
}

export interface Orders {
  num_orders: number
  this_month_orders: number
  month_growth: string
  order_count_overview: OrderCountOverview
  real_time: RealTime
  top_items: TopItem[]
  top_customers: TopCustomers
  diners: Diners
}

export interface OrderCountOverview {
  total: number
  closed: number
  cancelled: number
}

export interface RealTime {
  active: number
  occupied_tables: number
  total_tables: number
  distinct_order_items: number
}

export interface TopItem {
  item__name: string
  total_quantity: number
}

export interface TopCustomers {
  by_revenue: ByRevenue[]
  by_orders: ByOrder[]
}

export interface ByRevenue {
  customer?: string
  total_spent: number
}

export interface ByOrder {
  customer__first_name: string
  customer__last_name: string
  customer__username: string
  total_orders: number
}

export interface Diners {
  total: number
  monthly: number
  monthly_growth: string
}
export interface DiningArea {
  id: string
  name: string
  description: any
  smoking_zone: boolean
  outdoor_seating: boolean
  no_tables: number
  tables: DiningAreaTable[]
  isCollapsed:boolean
  available:boolean
}

export interface DiningAreaTable {
  id:any;
  number: number
  available: {available:boolean,message:string,order_id?:string}
  reserved: boolean
  enabled: boolean
}

export interface Pagination {
  paginated: boolean
  total_records: number
  number_of_pages: number
  page_size: number
  current_page: number
  has_next: boolean
  has_previous: boolean
}
export interface GroupedTableAreas {
  dining_area: DiningArea
  tables: DiningAreaTable[]
  isCollapsed:boolean
}

export interface RestaurantTag {
  id: string;
  name: string;
  category: 'allergen' | 'dietary' | 'descriptor';
  icon: string | null;
  colour: string;
  filterable: boolean;
  display_order: number;
  is_system_preset: boolean;
  created_at: string;
  updated_at: string;
}

export interface RestaurantTagUsageCount {
  count: number;
}

export interface UpsellConfig {
  id: string;
  enabled: boolean;
  title: string;
  max_items_to_show: number;
  hide_if_in_basket: boolean;
  hide_out_of_stock: boolean;
  items: UpsellItem[];
}

export interface UpsellItem {
  id: string;
  menu_item: string;
  item_id: string;
  item_name: string;
  item_price: number;
  item_image: string;
  item_available: boolean;
  item_in_stock: boolean;
  listing_position: number;
}




