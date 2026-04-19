import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Restaurant, MenuItem, ModifierGroup } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { parseModifierGroups } from 'src/app/_common/utils/modifier-utils';

@Component({
    selector: 'app-menu-common',
    templateUrl: './menu-common.component.html',
    styleUrl: './menu-common.component.css',
    standalone: false
})
export class MenuCommonComponent implements OnInit {
  restaurant?:Restaurant|any;
  @Input()restaurant_id:any='';
  menu_list?:MenuItem[]|any=[];
  basketItems = this.basketService.Basket().items;
  totalAmount = this.basketService.Basket().totalAmount;
  showModal=false;
  selected_item!:MenuItem|any
  selected_quantity:number=1;
  selected_amount:number=0;
  modifierGroups: ModifierGroup[] = [];
  selectedModifiers: Record<string, string[]> = {};
  selected_extras:any[]=[];
  currentSection=''
  currentSectionItem='';
 @Output() AddItem = new EventEmitter<any>();
 @Input() active_additem?:boolean=true;
    // New filtered list for search results
    filteredMenuList?: MenuItem[] | any = [];
    // Search query property
   searchQuery: string = '';
  constructor(private sessionStorage:SessionStorageService,private api:ApiService,private basketService:BasketService,private router:Router,private fb:FormBuilder) {
  }
  ngOnInit(){
this.loadMenu()
  }

  removeItem(Id: string) {
    this.basketService.removeItem(Id);
    this.udpateCart();
  }
get QuantitySum(){
 return this.basketItems.reduce((a, b) => a + b.quantity,0)
}
  udpateCart() {
    this.basketItems = this.basketService.Basket().items;
    this.totalAmount = this.basketService.Basket().totalAmount;
    this.SaveForProcessing();
  }
  loadMenu(){

    this.api.get<MenuItem>(null,'orders/journey/show-menu/',{restaurant:this.restaurant_id?this.restaurant_id:this.restaurant?.id,'ignore-approval':true}).subscribe((x)=>{
  this.menu_list=x.data as any;
  this.filteredMenuList = this.menu_list;
  this.currentSection=(this.menu_list[0] as MenuItem).name as string

    })
  }
  loadPreApprovalMenu(){
  }
  SaveForProcessing(){
    this.sessionStorage.setItem('Basket',this.basketItems);

  }
  viewItem(i:MenuItem){
    this.selected_item = i as any;
    this.modifierGroups = parseModifierGroups(i.options);
    this.selectedModifiers = {};
    this.selected_extras = [];
    this.showModal = true;
  }
  closeModal(){
    this.selected_item = null;
    this.modifierGroups = [];
    this.selectedModifiers = {};
    this.selected_extras = [];
    this.selected_quantity = 1;
    this.showModal = false;
  }
  AddSelectedItem(){
    this.AddItem.emit({
      item: this.selected_item.id,
      itemName: this.selected_item.name,
      quantity: this.selected_quantity,
      selected_modifiers: { ...this.selectedModifiers },
      extras: this.selected_extras.map(e => e.id),
    });
    this.selected_quantity = 1;
    this.selectedModifiers = {};
    this.selected_extras = [];
    this.closeModal();
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
    document.querySelector('#' + this.addUnderScore(section))?.scrollIntoView();
  }

  isModifierChoiceSelected(groupId: string, choiceId: string): boolean {
    return (this.selectedModifiers[groupId] || []).includes(choiceId);
  }

  getModifierSelectedCount(groupId: string): number {
    return (this.selectedModifiers[groupId] || []).length;
  }

  handleModifierSingleSelect(groupId: string, choiceId: string): void {
    const current = this.selectedModifiers[groupId] || [];
    if (current.length === 1 && current[0] === choiceId) {
      this.selectedModifiers = { ...this.selectedModifiers, [groupId]: [] };
    } else {
      this.selectedModifiers = { ...this.selectedModifiers, [groupId]: [choiceId] };
    }
  }

  handleModifierMultiSelect(
    groupId: string,
    choiceId: string,
    checked: boolean,
    maxSelections: number
  ): void {
    const current = this.selectedModifiers[groupId] || [];
    if (checked) {
      if (current.length >= maxSelections) return;
      this.selectedModifiers = { ...this.selectedModifiers, [groupId]: [...current, choiceId] };
    } else {
      this.selectedModifiers = {
        ...this.selectedModifiers,
        [groupId]: current.filter((id) => id !== choiceId),
      };
    }
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
    clearSearch() {
      this.searchQuery = '';
      this.filterMenu();
    }
    calculateDiscount(item:any): number {
      if (!item.discount_details.discount_amount) return 0;
      return Math.round(((item.primary_price - item.discount_details.discount_amount) / item.primary_price) * 100);
    }
    priceSaved(item:any): number {
      if (!item.discount_details.discount_amount) return 0;
      return item.primary_price - item.discount_details.discount_amount;
    }
    isExtraSelected(extra: {id:any,name:any, primary_price:number}): boolean {
      return this.selected_extras.includes(extra);
    }
    SetExtra(evnt:any,i:number,extra:{id:any,name:any, primary_price:number}){
      if(evnt.checked){
        this.selected_extras.push(extra);
      }else{
        this.selected_extras.splice(i,1)
      }

    }

}
