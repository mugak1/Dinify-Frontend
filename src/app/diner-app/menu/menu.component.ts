import { Component,ElementRef,Input,OnInit, ViewChild, AfterViewInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { MenuItem, Restaurant } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';

@Component({
    selector: 'app-diners-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.css'],
    standalone: false
})
export class DinersMenuComponent implements OnInit, AfterViewInit {
  @ViewChild('categoryContainer') categoryContainer!: ElementRef;

  disableLeftScroll = true;
  disableRightScroll = false;

  @ViewChild('optionsContainer') optionsContainer!: ElementRef;
  needsScrolling: boolean = false;

  showSearch:boolean=false;
  globalError:string|null=null;
  selected_extras: any[]=[];
  formSubmitted = false;


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

  constructor(private sessionStorage:SessionStorageService,private api:ApiService,private basketService:BasketService,private router:Router,private fb:FormBuilder) {
  this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  this.udpateCart();
  }
  ngOnInit(){
   
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
  ngAfterViewInit() {
    this.checkForScrolling();
  }

  checkForScrolling() {
    const container = this.optionsContainer.nativeElement;
    this.needsScrolling = container.scrollHeight > container.clientHeight;
  }
  onScroll() {
    const container = this.optionsContainer.nativeElement;
    const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
    
    this.needsScrolling = !isAtBottom;
  }
  /**
   * Filters each menu section based on the search query.
   * If no query is entered, the full menu list is shown.
   */
  filterMenu() {
    if (!this.searchQuery) {
      this.filteredMenuList = this.menu_list;
    } else {
      this.filteredMenuList = this.menu_list
        .map((section: any) => {
          const filteredItems = section.items.filter((item: any) =>
            item.name.toLowerCase().includes(this.searchQuery.toLowerCase())
          );
          return { ...section, items: filteredItems };
        })
        .filter((section: any) => section.items.length > 0);
    }
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
    this.api.get<MenuItem>(null,'orders/journey/show-menu/',{restaurant:this.restaurant_id?this.restaurant_id:this.restaurant?.id}).subscribe((x)=>{
  this.menu_list=(x?.data as any) ?? [];
          // Initially set the filtered list to the complete menu list
          this.filteredMenuList = this.menu_list;
  this.currentSection=((this.menu_list?.[0] as MenuItem)?.name as string) ?? ''
    })
  }
  clearSearch() {
    this.searchQuery = '';
    this.filterMenu();
  }

  SaveForProcessing(){
    this.sessionStorage.setItem('Basket',this.basketItems);
    
  }
  viewItem(i:MenuItem/* |Item */){
this.selected_item=i as any;
/* const modifiers = this.fb.array([]);
i.options.options.forEach((o,io)=>{
  modifiers.push(this.initOption());
  modifiers.at(io).setValue({id:io,name:o.name,choice:o.choices})
}) */
this.validateForm()
this.showModal=true;

setTimeout(() => {
 this.checkForScrolling(); 
}, 300);
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

  onSectionItemChange(sectionId: string) {
    this.currentSectionItem = sectionId;
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
  scrollCategory(direction: 'left' | 'right') {
    const container = this.categoryContainer.nativeElement;
    const scrollAmount = 150;

    if (direction === 'left') {
      container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }

    setTimeout(() => this.checkScrollButtons(), 300);
  }

  checkScrollButtons() {
    const container = this.categoryContainer.nativeElement;
    this.disableLeftScroll = container.scrollLeft <= 0;
    this.disableRightScroll = container.scrollLeft + container.clientWidth >= container.scrollWidth;
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
