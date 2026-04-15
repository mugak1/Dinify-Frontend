import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MenuItem, Restaurant } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { getTagColorClasses, getTagIcon } from 'src/app/_common/utils/tag-utils';
import { environment } from 'src/environments/environment';

@Component({
    selector: 'app-diners-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.css'],
    standalone: false
})
export class DinersMenuComponent implements OnInit, OnDestroy {
  url = environment.apiUrl;

  showSearch:boolean=false;
  globalError:string|null=null;
  selected_extras: any[]=[];
  formSubmitted = false;
  isLoading: boolean = true;
  private storageSub?: Subscription;


  toggleSearch() {
    this.showSearch = !this.showSearch;
    if (!this.showSearch) {
      this.clearSearch();
    }
  }
  @Input() restaurant?:Restaurant;
  @Input()restaurant_id:any='';
  menu_list?:MenuItem[]|any=[];
  basketItems = this.basketService.Basket().items;
  totalAmount = this.basketService.Basket().totalAmount;
  showModal=false;
  selected_item!:MenuItem|any
  selected_quantity:number=1;
  selected_amount:number=0;
  selected_choices:any[]=[];
  currentSection=''
  currentSectionItem=''
   // New filtered list for search results
   filteredMenuList?: MenuItem[] | any = [];
   // Search query property
  searchQuery: string = '';
  errorMessages: any[]=[];
  isFormValidFlag: boolean=true;
  editingBasketIndex: number | null = null;
  isEditMode = false;
  presetTags: any[] = [];
  showTagFilter = false;
  selectedTags: string[] = [];
  localSelectedTags: string[] = [];

  constructor(private sessionStorage:SessionStorageService,private api:ApiService,private basketService:BasketService,private router:Router,private fb:FormBuilder) {
  this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  this.presetTags = this.restaurant?.preset_tags || [];
  this.udpateCart();

  // When coming directly from a QR scan, the table-scan API call in the
  // DinerAppComponent wrapper may not have resolved yet — so session storage
  // may still be empty. Wait for the `restaurant` key to be set, then load.
  if (!this.restaurant) {
    this.storageSub = this.sessionStorage.StorageValue.subscribe((key: any) => {
      if (typeof key !== 'string' || !key.includes('restaurant')) return;
      const r = this.sessionStorage.getItem<Restaurant>('restaurant') as any;
      if (!r) return;
      this.restaurant = r;
      this.presetTags = this.restaurant?.preset_tags || [];
      this.storageSub?.unsubscribe();
      this.storageSub = undefined;
      this.tryLoadMenu();
    });
  }
  }

  getTagBadge(tagName: string): { colorClasses: string; iconSvg: string } {
    const preset = this.presetTags.find((p: any) => p.name === tagName);
    return {
      colorClasses: preset ? getTagColorClasses(preset.color) : 'bg-gray-100 text-gray-700',
      iconSvg: preset ? getTagIcon(preset.icon) : '',
    };
  }

  get filterableTags(): any[] {
    return this.presetTags.filter((t: any) => t.filterable);
  }

  getTagItemCount(tagName: string): number {
    if (!this.menu_list) return 0;
    let count = 0;
    for (const section of this.menu_list) {
      for (const item of section.items || []) {
        if (item.allergens?.includes(tagName)) count++;
      }
    }
    return count;
  }

  openTagFilter(): void {
    this.localSelectedTags = [...this.selectedTags];
    this.showTagFilter = true;
  }

  toggleTagSelection(tagName: string): void {
    this.localSelectedTags = this.localSelectedTags.includes(tagName)
      ? this.localSelectedTags.filter(t => t !== tagName)
      : [...this.localSelectedTags, tagName];
  }

  isTagSelected(tagName: string): boolean {
    return this.localSelectedTags.includes(tagName);
  }

  clearLocalTagSelection(): void {
    this.localSelectedTags = [];
  }

  onTagFilterApply(tags: string[]): void {
    this.selectedTags = tags;
    this.showTagFilter = false;
    this.filterMenu();
  }

  removeTag(tagName: string): void {
    this.selectedTags = this.selectedTags.filter(t => t !== tagName);
    this.filterMenu();
  }

  clearAllTags(): void {
    this.selectedTags = [];
    this.filterMenu();
  }
  ngOnInit(){
    // If restaurant is already available (session storage sync-read OR @Input()
    // from staff ordering), proceed immediately. Otherwise the StorageValue
    // subscription in the constructor will call tryLoadMenu() once it arrives.
    if (this.restaurant) {
      this.tryLoadMenu();
    }
  }

  ngOnDestroy(): void {
    this.storageSub?.unsubscribe();
  }

  private tryLoadMenu(): void {
    if(this.restaurant?.menu_approval_status=='approve'||(this.restaurant as any)?.first_time_menu_approval){
      this.loadMenu()
    }else{
      if(!this.router.url.includes('rest-app')){
      this.router.navigate(['/diner','error'])
      }else{
        this.router.navigate([this.router.url,'error'])
      }
    }
  }

  /**
   * Collects all featured items across all currently-visible sections
   * (respects active tag / search filters via filteredMenuList).
   */
  get featuredItems(): any[] {
    if (!this.filteredMenuList?.length) return [];
    const out: any[] = [];
    for (const section of this.filteredMenuList) {
      for (const item of section?.items || []) {
        if (item?.is_featured) out.push(item);
      }
    }
    return out;
  }
  /**
   * Computes the total price for the current item including selected
   * modifiers/options, extras, and quantity — used for the dynamic
   * "Add — UGX X,XXX" button.
   */
  get computedItemTotal(): number {
    if (!this.selected_item) return 0;
    const basePrice = this.selected_item?.running_discount
      ? (this.selected_item?.discount_details?.discount_amount ?? this.selected_item.primary_price)
      : this.selected_item.primary_price;
    const optionsCost = this.selected_choices.reduce(
      (acc: number, sel: any) => acc + (sel.order?.cost || 0), 0
    );
    const extrasCost = this.selected_extras.reduce(
      (acc: number, extra: any) => acc + (extra.primary_price || 0), 0
    );
    return (basePrice + optionsCost + extrasCost) * this.selected_quantity;
  }
  /**
   * Filters each menu section based on the search query.
   * If no query is entered, the full menu list is shown.
   */
  filterMenu() {
    if (!this.menu_list) return;

    let result = this.menu_list;

    if (this.selectedTags.length > 0) {
      result = result
        .map((section: any) => ({
          ...section,
          items: (section.items || []).filter((item: any) =>
            this.selectedTags.some(tag => item.allergens?.includes(tag))
          )
        }))
        .filter((section: any) => section.items.length > 0);
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result
        .map((section: any) => ({
          ...section,
          items: (section.items || []).filter((item: any) =>
            item.name.toLowerCase().includes(q)
          )
        }))
        .filter((section: any) => section.items.length > 0);
    }

    this.filteredMenuList = result;
  }
/*   addItem(item:Item){
    let px=item.primary_price;
    this.selected_choices.forEach(s=>{
      px=+s.order.cost
    })
    console.log(px)
this.basketService.addItem({itemId:item.id,itemName:item.name,price:px,quantity: this.selected_quantity,choice:0,option:0,options: this.selected_choices});
this.udpateCart();
this.router.navigate(['/diner/basket'])
  } */
  removeItem(Id: string) {
    this.basketService.removeItem(Id);
    this.udpateCart();
  }
get QuantitySum(){
 return this.basketItems.reduce((a, b) => a + b.quantity,0)
}
  udpateCart() {
    // Update cartItems and totalAmount after removing an item
    this.basketItems = this.basketService.Basket().items;
    this.totalAmount = this.basketService.Basket().totalAmount;
    this.SaveForProcessing();
  }
  loadMenu(){
    this.isLoading = true;
    this.api.get<MenuItem>(null,'orders/journey/show-menu/',{restaurant:this.restaurant_id?this.restaurant_id:this.restaurant?.id}).subscribe({
      next: (x:any) => {
        this.menu_list=(x?.data as any) ?? [];
        // Initially set the filtered list to the complete menu list
        this.filteredMenuList = this.menu_list;
        this.currentSection=((this.menu_list?.[0] as MenuItem)?.name as string) ?? ''
        // Cache upsell config so the basket can render it without another round-trip
        if (x?.upsell) {
          this.sessionStorage.setItem('upsellConfig', x.upsell);
        } else {
          this.sessionStorage.removeItem?.('upsellConfig');
        }
        // If the user tapped a basket item, re-open the detail modal pre-populated
        this.checkEditMode();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    })
  }

  /**
   * Locates a menu item by its id across all sections of the loaded menu.
   */
  findMenuItemById(itemId: string): any {
    for (const section of this.menu_list || []) {
      const item = (section.items || []).find((i: any) => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  /**
   * If sessionStorage has an `editingBasketItem` context, enter edit mode:
   * pre-populate the detail modal selections from the basket item and open it.
   */
  private checkEditMode(): void {
    const editContext = this.sessionStorage.getItem<any>('editingBasketItem');
    if (!editContext) return;
    // Clear immediately so it doesn't re-fire on a future menu visit
    this.sessionStorage.removeItem('editingBasketItem');

    const menuItem = this.findMenuItemById(editContext.itemId);
    if (!menuItem) return;

    const basketItem = this.basketItems[editContext.basketIndex];
    if (!basketItem) return;

    this.editingBasketIndex = editContext.basketIndex;
    this.isEditMode = true;

    this.selected_item = menuItem;
    this.selected_quantity = basketItem.quantity;

    // Reconstruct selected_choices from stored optionIndex/choiceIndex
    this.selected_choices = (basketItem.options || [])
      .filter((opt: any) => opt.choice && opt.choice !== 'None')
      .map((opt: any) => {
        const optionGroup = menuItem.options?.options?.[opt.optionIndex];
        return optionGroup
          ? { index: opt.optionIndex, choice: opt.choice,
              choiceIndex: opt.choiceIndex, order: optionGroup }
          : null;
      })
      .filter(Boolean);

    // Reconstruct selected_extras by id (use the menuItem's own refs so
    // isExtraSelected's identity-based check matches)
    this.selected_extras = (basketItem.extras || [])
      .map((ext: any) => (menuItem.extras || []).find((e: any) => e.id === ext.id))
      .filter(Boolean);

    this.validateForm(); // also sets option.isSelected on each option group
    this.showModal = true;
  }

  private resetEditMode(): void {
    this.isEditMode = false;
    this.editingBasketIndex = null;
    this.selected_quantity = 1;
    this.selected_choices = [];
    this.selected_extras = [];
  }
  clearSearch() {
    this.searchQuery = '';
    this.filterMenu();
  }

  SaveForProcessing(){
    this.sessionStorage.setItem('Basket',this.basketItems);
    
  }
  viewItem(i:MenuItem/* |Item */){
if (this.isOutOfStock(i)) return;
this.selected_item=i as any;
/* const modifiers = this.fb.array([]);
i.options.options.forEach((o,io)=>{
  modifiers.push(this.initOption());
  modifiers.at(io).setValue({id:io,name:o.name,choice:o.choices})
}) */
this.validateForm()
this.showModal=true;
  }
  initOption(){
    return this.fb.group({
      ind:[''],
      name:[''],
      choice:['']
    })
  }
  closeModal(){
    this.showModal=false;
    if (this.isEditMode) {
      this.resetEditMode();
      this.router.navigate(['/diner/basket']);
    }
  }
  AddSelectedItem(){
    this.formSubmitted = false; // Reset form submission flag
      // Ensure the form is valid before proceeding
  if (!this.isFormValid()) {
    this.formSubmitted = true; // Set flag to indicate form submission
    return;
  }
 // Prepare selected options for visualization
 /*  const selectedOptions = this.selected_choices.map((sel) => ({
    optionName: sel.order.name, // The name of the option group (e.g., "Size", "Extras")
    choice: sel.choice || 'None', // The selected choice for that option
    cost: sel.order.cost || 0, // The additional cost of the selected choice
  })); */
  // Prepare selected options for visualization & backend
  const selectedOptions = this.selected_choices.map((sel, _optionIndex) => {
    

    return {
  optionName: sel.order.name,
  choice: sel.choice || 'None',
  cost: sel.order.cost || 0,
  optionIndex: sel.index,       // option group index
  choiceIndex: sel.choiceIndex  // numeric index from SetChoice
/*       optionName: sel.order.name,
      choice: sel.choice || 'None',
      cost: sel.order.cost || 0,
      optionIndex: optionIndex,   // index of the option group
      choiceIndex: choiceIndex    // index of the chosen option */
    };
  });

  // Prepare selected extras for visualization
  const selectedExtras = this.selected_extras.map((extra) => ({
    id:extra.id,
    name: extra.name,
    cost: extra.primary_price || 0,
  }));

// Check if the item has a discount
const discount = this.selected_item?.discount_details?.discount_amount ?? 0;
const isDiscounted = this.selected_item?.running_discount; //!!discount;

const originalBasePrice = this.selected_item?.primary_price;
const basePrice = isDiscounted ? discount : originalBasePrice; // discounted price if present

// Calculate total including selected options and extras
const totalPrice = (basePrice)
  + selectedOptions.reduce((acc, opt) => acc + opt.cost, 0)
  + selectedExtras.reduce((acc, extra) => acc + extra.cost, 0);

// Add the item with full details to the basket
const basketItem = {
  itemId: this.selected_item.id,
  itemName: this.selected_item.name,
  image: this.selected_item.image || null,
  basePrice: basePrice,
  totalPrice: totalPrice,
  quantity: this.selected_quantity,
  options: selectedOptions,
  extras: selectedExtras,
  isDiscounted: isDiscounted,
  originalBasePrice: isDiscounted ? originalBasePrice : undefined,
  discountAmount: isDiscounted ? originalBasePrice - basePrice : undefined,
  discountPercentage: isDiscounted ? Math.round((1 - basePrice / originalBasePrice) * 100) : undefined
};

if (this.isEditMode && this.editingBasketIndex !== null) {
  // Replace the existing basket item in place instead of appending a new one
  this.basketService.updateItem(this.editingBasketIndex, basketItem);
  this.udpateCart();
  this.closeModal(); // closeModal handles resetEditMode + navigation to basket
  return;
}

this.basketService.addItem(basketItem);
/*   // Prepare selected options for visualization
  const selectedOptions = this.selected_choices.map((sel) => ({
    optionName: sel.order.name, // The name of the option group (e.g., "Size", "Extras")
    choice: sel.choice || 'None', // The selected choice for that option
    cost: sel.order.cost || 0, // The additional cost of the selected choice
  }));

  // Prepare selected extras for visualization
  const selectedExtras = this.selected_extras.map((extra) => ({
    name: extra.name,
    cost: extra.primary_price || 0,
  }));


  // Calculate the total price, including the primary item price and all selected option costs
  const totalPrice = this.selected_item.primary_price 
                    + selectedOptions.reduce((acc, opt) => acc + opt.cost, 0)
                    + selectedExtras.reduce((acc, extra) => acc + extra.cost, 0);

  // Add the item with options to the basket
  const basketItem = {
    itemId: this.selected_item.id,
    itemName: this.selected_item.name,
    basePrice: this.selected_item.primary_price,
    totalPrice: totalPrice,
    quantity: this.selected_quantity,
    options: selectedOptions,
    extras: selectedExtras
  };

  this.basketService.addItem(basketItem); // Add the item to the basket */
  // Update the cart view and reset the form
  this.udpateCart();
  this.closeModal();
  this.selected_quantity = 1; // Reset quantity to default
  this.selected_choices = []; // Clear selected choices 
  this.selected_extras = []; // Clear selected extras
  
/*     let px=this.selected_item.primary_price;
    this.selected_choices.forEach(s=>{
      px=px+s.order.cost
      console.log(px)
    })
    this.basketService.addItem({itemId:this.selected_item.id,itemName:this.selected_item.name,price:px,quantity: this.selected_quantity,choice:0,option:0,options:this.selected_choices});
this.udpateCart();
this.closeModal();
this.selected_quantity=1; */
  }
 
addUnderScore(x:string){
  return x.replace(/ /g,"_");
}

removeUnderscore(x:string){
  return x.replace(/_/g," ");
}
  onSectionChange(sectionId: string) {
    this.currentSection = sectionId;
  }

  scrollTo(section:any,_i:number) {
    document.querySelector('#' + this.addUnderScore(section))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
 
  }
  checkSelected(): any {
    return this.selected_quantity > 1 ? this.selected_quantity-- : null
  }
  AddSelected(): any {
    this.selected_quantity++
  }
  sanitizeId(name: string): string {
    return name.replace(/\s+/g, '-').toLowerCase();
  }
/*   scrollTo(sectionName: string, index: number) {
    const sanitizedId = this.sanitizeId(sectionName);
    const element = document.getElementById(sanitizedId);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.currentSection = sectionName;
    }
  } */

  SetChoice(event: any, i: number, choiceIndex: number | null, option: any, choice?: any): void {
const max = option.max_choices || 1;
  const selectedForOption = this.selected_choices.filter(sel => sel.index === i);

  if (choiceIndex !== null) {
    const isMultiSelect = max > 1;
    const existingIndex = this.selected_choices.findIndex(sel => sel.index === i && sel.choice === choice);

    if (existingIndex > -1) {
      // Deselect
      this.selected_choices.splice(existingIndex, 1);
    } else {
      if (isMultiSelect) {
        if (selectedForOption.length >= max) return; // Max reached
        this.selected_choices.push({ index: i, choice, choiceIndex, order: option });
      } else {
        // Single-select mode: remove any previous, then add new
        this.selected_choices = this.selected_choices.filter(sel => sel.index !== i);
        this.selected_choices.push({ index: i, choice, choiceIndex, order: option });
      }
    }

    // Update selection status for the UI
    option.isSelected = this.selected_choices.some(sel => sel.index === i);
  } else {
    // Checkbox-style
    option.isSelected = event.target.checked;

    if (option.isSelected) {
      if (selectedForOption.length >= max) {
        option.isSelected = false;
        return; // Max reached
      }
      this.selected_choices.push({ index: i, choice: null, order: option });
    } else {
      this.selected_choices = this.selected_choices.filter(sel => sel.index !== i);
    }
  }

    /* if (choiceIndex !== null) {
    // Toggle behavior: unselect if already selected
    const existing = this.selected_choices.find(sel => sel.index === i && sel.choice?.value === choice?.value);
    
    if (existing) {
      // Already selected: unselect
      option.isSelected = false;
      this.selected_choices = this.selected_choices.filter(sel => sel.index !== i);
    } else {
      // Select new choice
      option.choices.forEach((_: string, idx: number) => {
        option.isSelected = (idx === choiceIndex); // only one true
      });

      this.selected_choices = this.selected_choices.filter(sel => sel.index !== i);
      this.selected_choices.push({ index: i, choice: choice, order: option });
    }
  } else {
    // Checkbox-style toggle
    option.isSelected = event.target.checked;

    if (option.isSelected) {
      this.selected_choices.push({ index: i, choice: null, order: option });
    } else {
      this.selected_choices = this.selected_choices.filter(sel => sel.index !== i);
    }
  } */
    /* if (choiceIndex !== null) {
      // Radio-style behavior for selectable options
      option.choices.forEach((_: string, idx: number) => {
        if (choiceIndex === idx) {
          option.isSelected = true; // Mark as selected
        }
      });
  
      this.selected_choices = this.selected_choices.filter((sel) => sel.index !== i); // Remove existing selection
      this.selected_choices.push({ index: i, choice: choice, order: option }); // Add the new choice
    } else {
      // Checkbox-style behavior for non-selectable options
      option.isSelected = event.target.checked;
      if (option.isSelected) {
        this.selected_choices.push({ index: i, choice: null, order: option });
      } else {
        this.selected_choices = this.selected_choices.filter((sel) => sel.index !== i); // Remove if unchecked
      }
    } */
  
    // Validate the form after every change
    this.validateForm();
  }
  selectedCount(i: number): number {
  return this.selected_choices.filter(sel => sel.index === i).length;
}
  isSelected(option: any, choice: string): boolean {
    // Check if the current choice is selected
    return this.selected_choices.some(
      (sel) => sel.order.name === option.name && sel.choice === choice
    );
  }
  
  validateForm(): void {
    this.errorMessages = []; // Reset error messages
  
    // Check all required options
    this.selected_item?.options?.options?.forEach((option: any) => {
      option.isSelected = this.selected_choices.some((sel) => sel.order.name === option.name); // Update state
      if (option.required && !option.isSelected) {
        this.errorMessages.push(`Please select an option for "${option.name}".`);
      }
    });
  
    // Set overall form validity
    this.isFormValidFlag = this.errorMessages.length === 0;
  }
  
  isFormValid(): boolean {
    return this.isFormValidFlag;
  }
  
  submitForm(): void {
    this.validateForm();
    if (this.isFormValid()) {
      // form is valid - proceed
    } else {
      // form is invalid - handled by validateForm
    }
  }
  calculateDiscount(item:any): number {
    if (!item?.discount_details?.discount_amount) return 0;
    return Math.round(((item.primary_price - item.discount_details.discount_amount) / item.primary_price) * 100);
  }
  priceSaved(item:any): number {
    if (!item?.discount_details?.discount_amount) return 0;
    return item.primary_price - item.discount_details.discount_amount;
  }
  isOutOfStock(item: any): boolean {
    return item.in_stock === false;
  }
  getDiscountBadge(item: any): string {
    if (!item?.running_discount) return '';
    const pct = this.calculateDiscount(item);
    return pct > 0 ? `-${pct}%` : '';
  }
  validateSelections(): boolean {
    let isValid = true;
    let totalSelected = 0;
  
    this.selected_item?.options?.options.forEach((option: any) => {
      const selectedCount = option.choices?.filter((c: any) => c.isSelected).length || 0;
  
      option.error = null; // clear previous error
  
      // Count towards global total
      totalSelected += selectedCount;
  
      // Per-option validation
      if (option.required && selectedCount === 0) {
        option.error = 'Please select at least 1 option.';
        isValid = false;
      }
  
      if (option.min_selections && selectedCount < option.min_selections) {
        option.error = `Pick at least ${option.min_selections}`;
        isValid = false;
      }
  
      if (option.max_selections && selectedCount > option.max_selections) {
        option.error = `Pick at most ${option.max_selections}`;
        isValid = false;
      }
    });
  
    // Global validation
    const globalMin = this.selected_item?.options?.min_selections;
    const globalMax = this.selected_item?.options?.max_selections;
  
    this.globalError = null; // reset
  
    if (globalMin && totalSelected < globalMin) {
      this.globalError = `Please select at least ${globalMin} options in total.`;
      isValid = false;
    }
  
    if (globalMax && totalSelected > globalMax) {
      this.globalError = `You can only select up to ${globalMax} options in total.`;
      isValid = false;
    }
  
    return isValid;
  }
  isExtraSelected(extra: {id:any,name:any, primary_price:number}): boolean {
    // Check if the current extra is selected
    return this.selected_extras.includes(extra);
  }
  SetExtra(i:number,extra:{id:any,name:any, primary_price:number}){
    const index = this.selected_extras.findIndex(x => x.id === extra.id);
  
    if (index === -1) {
      this.selected_extras.push(extra); // Add extra if not already selected
    } else {
      this.selected_extras.splice(index, 1); // Remove the correct extra
    }
  
  }
  
}
