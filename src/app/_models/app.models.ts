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
  cover_photo: any
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
export interface MenuItem {
  id: string
  name: string
  description: any
  calories?: number | null
  primary_price: number
  discounted_price: any
  running_discount: boolean
  image: string
  available: boolean
  has_options: boolean
  options: MenuOptions
  group:{id:any,name:any},
  allergens:[]
  is_extra:boolean
  has_extras:boolean
  extras:any[],
  has_discount:boolean;
  discount_details?:any
  is_featured?: boolean
  is_popular?: boolean
  is_new?: boolean
  in_stock?: boolean
  is_special?: boolean
  discount_percentage?: number
}

export interface MenuOptions {
  min_selections:number;
  max_selections:number;
  options:MenuItemOption[];
}

export interface MenuItemOption {
  name: string;
  selectable: boolean /** Does it have options to select from */
  options: any[];
  choices?:any[]
  cost: number,
  required:boolean;
  isSelected?:boolean;
  hasError?:boolean;
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

export interface ItemDiscountDetails {
  discount_type?: 'percentage' | 'fixed';
  discount_amount: number;
  start_date: string;
  end_date: string;
  recurring_days: number[];
  raw_discount_value?: number;
  raw_discount_type?: 'percentage' | 'fixed';
}

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
  cover_photo: string
  status: string
  require_order_prepayments: boolean
  expose_order_ratings: boolean
  allow_deliveries: boolean
  allow_pickups: boolean
  preferred_subscription_method: string
  order_surcharge_percentage: number
  flat_fee: number
  order_surcharge_min_amount: number
  order_surcharge_cap_amount: number
  branding_configuration: BrandingConfiguration
  country: string
  first_time_menu_approval: boolean
  first_time_menu_approval_decision: string
  created_by: string
  deleted_by: any
  owner: string
  subscription_validity:boolean;
  subscription_expiry_date:any;
}
export interface Restaurant {
  id: string
  name: string
  logo: string
  cover_photo: any
  menu_approval_status:any
  branding_configuration: BrandingConfiguration
  preset_tags?: any[]
}

export interface BrandingConfiguration {
  home: Home
}

export interface Home {
  bgColor: string
  headerCase: string
  headerShow: string
  headerColor: string
  headerTextColor:string
  headerShowName: string
  viewMenuBgColor: string
  headerFontWeight: string
  viewMenuTextColor: string
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

/* export interface BasketItem {
  itemId: string;
  itemName: string;
  price: number;
  quantity: number;
  option?:any;
  choice?:any;
  extras?:any[];
  options?:any;
} */
  export interface BasketItem {
    itemId: string; // Unique ID of the selected item
    itemName: string; // Name of the selected item
    image?: string; // Optional image path used for cart thumbnails
    basePrice: number; // Primary price of the item
    totalPrice: number; // Final calculated price including options
    quantity: number; // Quantity of the item selected
    options: SelectedOption[]; // Array of selected options
    extras: any[]; // Array of selected extras (if any)
    isDiscounted?: boolean; // flag if discounted
    originalBasePrice?: number;  // NEW: the pre-discount price
    discountAmount?: number;  // NEW: discount amount in UGX
    discountPercentage?: number;  // NEW: discount in %
  }
  
 export interface SelectedOption {
    optionName: string; // Name of the option group (e.g., "Size", "Extras")
    choice: string; // Selected choice for the option
    cost: number; // Cost associated with the choice
    optionIndex?: number; // Index of the option group within the menu item's options
    choiceIndex?: number; // Index of the selected choice within the option group
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
  order_remarks: any
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
  order_remarks:string;
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
  momo_actual_balance: number
  momo_available_balance: number
  momo_cumulative_in: number
  momo_cumulative_out: number
  momo_cumulative_in_charges: number
  momo_cumulative_out_charges: number
  momo_cumulative_refunds: number
  momo_cumulative_disbursements: number
  card_actual_balance: number
  card_available_balance: number
  card_cumulative_in: number
  card_cumulative_out: number
  card_cumulative_in_charges: number
  card_cumulative_out_charges: number
  card_cumulative_refunds: number
  card_cumulative_disbursements: number
  cash_actual_balance: number
  cash_available_balance: number
  cash_cumulative_in: number
  cash_cumulative_out: number
  cash_cumulative_in_charges: number
  cash_cumulative_out_charges: number
  cash_cumulative_refunds: number
  cash_cumulative_disbursements: number
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
  account_balances: AccountBalances
}

export interface AccountBalances {
  after: AccountTransaction
  before: AccountTransaction
}

export interface AccountTransaction{
  card_cumulative_in: string
  cash_cumulative_in: string
  momo_cumulative_in: string
  card_actual_balance: string
  card_cumulative_out: string
  cash_actual_balance: string
  cash_cumulative_out: string
  momo_actual_balance: string
  momo_cumulative_out: string
  card_available_balance: string
  cash_available_balance: string
  momo_available_balance: string
  card_cumulative_refunds: string
  cash_cumulative_refunds: string
  momo_cumulative_refunds: string
  card_cumulative_in_charges: string
  cash_cumulative_in_charges: string
  momo_cumulative_in_charges: string
  card_cumulative_out_charges: string
  cash_cumulative_out_charges: string
  momo_cumulative_out_charges: string
  card_cumulative_disbursements: string
  cash_cumulative_disbursements: string
  momo_cumulative_disbursements: string
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
export interface Ticket {
  id: string;
  ticket_type: 'Incident' | 'Request'| 'Problem'| 'Change'| 'feedback'|'support';
  ticket_title: string;
  ticket_description: string;
  ticket_status: 'open' | 'In Progress' | 'closed';
  resolution_notes: string;
  time_created: string
  time_last_updated: string
  time_deleted: any
  deleted: boolean
  deletion_reason: any
  archived: boolean
  ticket_priority: string
  created_by: string
  deleted_by: any
  restaurant: any
  assigned_to: any
  assigned_by: any
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
export interface Message {
  message: string;
  severity: string;
  summary?: string;
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
  surcharge: number
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
  position: number;
  menu_item_details?: MenuItem;
}




