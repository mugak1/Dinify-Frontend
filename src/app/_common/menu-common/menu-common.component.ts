import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { FormBuilder, FormArray } from '@angular/forms';
import { Router } from '@angular/router';
import { Restaurant, MenuItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { BasketService } from 'src/app/_services/basket.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';

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
  selected_choices:any[]=[];
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
 // this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  }
  ngOnInit(){
this.loadMenu()
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

    this.api.get<MenuItem>(null,'orders/journey/show-menu/',{restaurant:this.restaurant_id?this.restaurant_id:this.restaurant?.id,'ignore-approval':true}).subscribe((x)=>{
  this.menu_list=x.data as any;
  this.filteredMenuList = this.menu_list;
  this.currentSection=(this.menu_list[0] as MenuItem).name as string
      
    })
  }
  loadPreApprovalMenu(){
   // this.api.get<MenuItem>(null,'restaurant-setup/menuitems/',{section:section}).subscribe((x)=>{})
  }
  SaveForProcessing(){
    this.sessionStorage.setItem('Basket',this.basketItems);
    
  }
  viewItem(i:MenuItem/* |Item */){
this.selected_item=i as any;
const _modifiers:FormArray= this.fb.array([]);
/* i.options.options.forEach((o,io)=>{
  modifiers.push(this.initOption());
  modifiers.at(io).setValue({id:io,name:o.name,choice:o.choices})
}) */
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
    this.selected_item=null;
    this.selected_choices=[];
    this.selected_quantity=1;
    this.showModal=false;
  }
  AddSelectedItem(){
    let px=this.selected_item.primary_price;
    this.selected_choices.forEach(s=>{
      px=px+s.order.cost

    })
    const baskItm={item:this.selected_item.id,itemName:this.selected_item.name,price:px,quantity: this.selected_quantity,choice:null,option:null,options:this.selected_choices}
    if(this.restaurant_id){
this.AddItem.emit(baskItm);
    }else{
 /*          this.basketService.addItem(baskItm);
this.udpateCart();
this.closeModal(); */
    }

this.selected_quantity=1;
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
  /*   if(i==0){
      window.scrollBy(0, -100);
    } */
  }
  SetChoice(evnt:any,i:any,has_choices?:any,o?:any,_op?:any){
const sel = {index:i, choice:has_choices,order:o}

    if(evnt.checked){
     
      if(o?.selectable){
        if(this.selected_choices.filter(x=>x.index==i).length>0){
          const indo=this.selected_choices.indexOf(this.selected_choices.filter(x=>x.index==i)[0])
          
            this.selected_choices.splice(indo,1)
          
          
        }
      }   
      this.selected_choices.push(sel);
    }else{
    // console.log(this.selected_choices.filter(x=>x.index==i))
      if(this.selected_choices.filter(x=>x.index==i).length>0){
        const indo=this.selected_choices.indexOf(this.selected_choices.filter(x=>x.index==i)[0])
        
          this.selected_choices.splice(indo,1)
        
        
      }
     /* if(this.selected_choices.includes(i)){
        this.selected_choices.splice(i)
      } */
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
    isSelected(option: any, choice: string): boolean {
      // Check if the current choice is selected
      return this.selected_choices.some(
        (sel) => sel.order.name === option.name && sel.choice === choice
      );
    }
    isExtraSelected(extra: {id:any,name:any, primary_price:number}): boolean {
      // Check if the current extra is selected
      return this.selected_extras.includes(extra);
    }
    SetExtra(evnt:any,i:number,extra:{id:any,name:any, primary_price:number}){
      if(evnt.checked){
        this.selected_extras.push(extra);
      }else{
        //let indo=this.selected_extras.indexOf(this.selected_extras.filter(x=>x.id==extra.id)[0])
        this.selected_extras.splice(i,1)
      }

    }
    
}
