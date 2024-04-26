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
}

export interface Profile {
  id: string
  first_name: string
  last_name: string
  email: string
  roles: string
  other_names: any
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
}
export interface RestaurantList {
  id: string
  name: string
  location: string
  logo: string
  status:string
  cover_photo: any
}
export interface MenuSectionListItem {
  id: string
  name: string
  description: string
  section_banner_image: any
  available: boolean
  item_count:number
}
export interface MenuItem {
  id: string
  name: string
  description: any
  primary_price: number
  discounted_price: any
  running_discount: boolean
  image: string
  available: boolean
  has_options: boolean
  options: MenuOptions
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
  cost: number
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

export interface Restaurant {
  id: string
  name: string
  logo: string
  cover_photo: any
  branding_configuration: BrandingConfiguration
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
export interface MenuItem {
  id: string
  name: string
  section_banner_image: any
  available: boolean
  item_count: number
  groups: any[]
  items: Item[]
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

export interface Options {}