import { DOCUMENT, Location } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, Inject, AfterViewInit, OnDestroy } from '@angular/core';
import { FormGroup, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { DiningArea, DiningAreaTable, GroupedTableAreas, OrderedItem, OrdersListItem, RestaurantDetail, TableListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { Buffer } from 'buffer';
import * as JSLZString from 'lz-string';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { BasketService } from 'src/app/_services/basket.service';

@Component({
  selector: 'app-tables',
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.css']
})
export class TablesComponent implements AfterViewInit, OnDestroy {
  showModal = false;
  detailModal=false;
  rest?:any;
  TableForm!:FormGroup;
  DiningAreaForm!:FormGroup;
  TableEditForm!:FormGroup;
  is_submitted=false;
  fileName='';
  list?:GroupedTableAreas[]=[];
  restaurant: any;
  enc_restaurant:any='';
bsref='';
saving=false;

public qrCodeDownloadLink: SafeUrl = "";
areas: string[] = ['Main Hall', 'VIP Section']; // Example: List of areas
isSingleArea = false;
current_restaurant:any;

order?:OrdersListItem;
view_menu:boolean=false;
edit_menu=false;

  /**
   *
   */
  constructor(public auth:AuthenticationService, private fb:FormBuilder,private api:ApiService,private route:ActivatedRoute,private router:Router,@Inject(DOCUMENT) private document: Document, private dialog:ConfirmDialogService, private sessionStorage:SessionStorageService, private basketService:BasketService, private location:Location, private cdr: ChangeDetectorRef) {


    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
      this.enc_restaurant=btoa(this.restaurant)
        this.loadAreas(); 
    }else 
    if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
      this.enc_restaurant=btoa(this.restaurant)
        this.loadAreas(); 
    }
this.bsref=this.document.location.origin;
if(this.auth.currentRestaurant){
this.sessionStorage.setItem('restaurant',this.auth.currentRestaurant);
}else{
  this.loadRestaurant();
}
this.route.url.subscribe((x)=>{
  if(!this.router.url.includes('menu')){
      this.router.navigate(this.auth?.currentRestaurantRole?.restaurant_id?['/rest-app/dining-tables']:['/mgt-app/restaurants/rest-app',this.restaurant,'dining-tables']);
      this.closeMenu();
    }
})
//window.addEventListener('popstate', this.handleBackNavigation);


//this.CreateTable5();
  }
  ngAfterViewInit(){
    this.router.events.subscribe(() => {
      this.cdr.detectChanges();
  });
  }
  handleBackNavigation = () => {
    
  };
ngOnDestroy() {
  //window.removeEventListener('popstate', this.handleBackNavigation);
}
  loadRestaurant(){
    this.api.get<RestaurantDetail>(null,'restaurant-setup/'+'details/',{id:this.restaurant,record:'restaurants'}).subscribe((x)=>{
     
        this.sessionStorage.setItem('restaurant',x.data);
       this.current_restaurant=x.data as any;  
      
    })
  }
  toggleModal(val?:any,view_detaail?:boolean,area?:DiningArea){
    if(view_detaail){
this.detailModal=true;
this.rest=val;
    }else{

    if(val){
      this.TableEditForm=this.initTableForm()
      val.dining_area=area?.id;
      this.TableEditForm.patchValue(val);    
    }else{
           this.TableForm=this.initSectionTableForm();   
    }  
    }
    this.showModal = !this.showModal;  
  }
  typOf(val:any){
    return typeof val
  }
  closeModal(){
    this.rest=undefined;
    this.TableForm=null!;
    this.TableEditForm=null!;
    this.DiningAreaForm=null!;
    if(this.detailModal){this.detailModal=false;}    
    this.showModal = !this.showModal;
  }
  initTableForm(){
return this.fb.group({
  id:[''],
  restaurant:[this.restaurant],
  number:['',[Validators.required,Validators.pattern('^[1-9]\\d*$'),Validators.min(1)]],
  //room_name:[''],
 /* prepayment_required:[''],
  "outdoor_seating": [true],
  smoking_zone:[true],
  available:[true],*/
dining_area:[''],
})
  }
  onAreaModeChange(mode: string) {
    this.isSingleArea = mode === 'single';
  
    if (this.isSingleArea) {
      // Set the default area if only one area exists
      //this.areas.patchValue({ room_name: this.areas[0] });
      this.DiningAreaForm.patchValue({name:this.areas[0]})
    } else {
      // Clear the room_name when switching to multiple areas
      this.DiningAreaForm.patchValue({ name: '' });
    }
  }
  initSectionTableForm(){
    return this.fb.group({
      id:[''],
      restaurant:[this.restaurant],
      number:[''],
      name:[''],
      prepayment_required:[''],
      smoking_zone:[true],
      outdoor_seating:[true],
      "consideration": ["range"],
      available:[true],
      start:['',Validators.required],
      end:['',Validators.required]
    })
      }

  CreateTable5(){
    this.TableForm=this.initTableForm();
    this.TableForm.patchValue({"restaurant":"bb6ee380-0b1d-4061-b3a2-ca6fb5e9e258","number":"6","room_name":"Non Smoking Zone","available":true});
    this.Save();
  }
 
  Save(){
this.saving=true;
const payload = this.TableEditForm?.get('id')?.value? this.TableEditForm.value:this.TableForm.value;
    this.api.postPatch('restaurant-setup/tables/',payload,this.TableEditForm?.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{

        const ind = this.list?.filter(x=>x.dining_area.id==(this.TableForm?this.TableForm.get('dining_area')?.value:this.TableEditForm?.get('dining_area')?.value));
        if(ind&&this.list){
          // ind[0].tables.push(this.TableForm.value)
          
           

this.loadAreas(null as any,this.list?.findIndex(x=>x.dining_area.id==(this.TableEditForm?.get('id')?.value? this.TableEditForm.get('dining_area')?.value:this.TableForm?.get('dining_area')?.value)));
this.saving=false;          
this.closeModal();//this.list[ as number].isCollapsed=false;
          // this.list?.indexOf(ind[0])
          // console.log(this.list?.indexOf(ind[0]))
         }




      
//this.list?.indexOf(x=>x.id==this.TableForm.get('dining_area')?.value)
      },
     error:(err)=>{
this.saving=false
   //   alert(err)
     }
      //console.log(x)
    })
  }
  SaveSections(){
 
    this.api.postPatch(this.TableForm.get('id')?.value?'restaurant-setup/tables/':'restaurant-setup/section-tables/',this.TableForm.value,this.TableForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
this.closeModal();
this.loadTables();
      },
     error:(err)=>{

   //   alert(err)
     }
      //console.log(x)
    })
  }
  ask_multiple:boolean=false;
  loadTables(id?:string){
    
    this.api.get<any>(null,'restaurant-setup/tables/',{restaurant:this.restaurant}).subscribe((x)=>{
      if(id){
this.rest=x?.data?.records[0];
this.showModal!=this.showModal;
      }else{
      this.list=x?.data?.records  
      // Extract all distinct names
const distinctNames = new Set(this.list?.map(item => item.dining_area.name));

// Count distinct items
const countDistinct = distinctNames.size;
      if(this.list?.length==0&&countDistinct>1){
this.ask_multiple=true;

      }
      }
      
    })
  }
  loadNullAreas(id?:string,openIndex?:number){
    
    this.api.get<any>(null,'restaurant-setup/diningareas/',{restaurant:this.restaurant}).subscribe((x)=>{
      if(id){
/* this.rest=x?.data?.records[0];
this.showModal!=this.showModal; */
      }else{
      this.list=x?.data?.records.map(area => ({ ...area, isCollapsed: x?.data?.records.length==1? (false):true }));
      if(openIndex&&this.list){
        this.list[openIndex].isCollapsed=false;
      }


      }
      
    })
  }
  loadAreas(id?:string,openIndex?:number){
    
    this.api.get(null,'restaurant-setup/tables/',{restaurant:this.restaurant,grouping:'areas'}).subscribe((x)=>{
      if(id){
/* this.rest=x?.data?.records[0];
this.showModal!=this.showModal; */
      }else{
        const d :any[] =x?.data as any;
      this.list=d.map(area => ({ ...area, isCollapsed: d.length==1? (false):true }));

      if(openIndex!==undefined){
        this.list[openIndex].isCollapsed=false;
      }


      }
      
    })
  }
  onChangeURL(url: SafeUrl) {
    this.qrCodeDownloadLink = url;
  }
  DeleteTable(table:DiningAreaTable,areaIndex:number){
    const ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      reason_required:true,
      //action_info:'This table will no longer be available for booking',
      message:'Are you sure you want to <strong>Delete</strong> Table No. '+table.number +'? <br> Please provide the reason for deleting the table',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('restaurant-setup/tables/',{id:table.id,deletion_reason:x?.reason}).subscribe({
          next: ()=>{
      //this.save.emit(x)
      this.loadAreas(null as any,areaIndex);
      this.dialog.closeModal();
      ref.unsubscribe();
          },
          error:(err)=>{
           // alert(err)
          }
        });
        //this.dialog.closeModal();
      }
      if(x?.action=='no'||x?.action=='reject'){
        
        this.dialog.closeModal();
        ref.unsubscribe();
      }
  
      
    });
  
  
  }
  NewArea(){
    this.isSingleArea = false;
    this.DiningAreaForm=this.initArea();
          // Extract all distinct names
const distinctNames = new Set(this.list?.map(item => item.dining_area.name));

// Count distinct items
const countDistinct = distinctNames.size;
      if(this.list?.length==0){
this.ask_multiple=true;

      }else{
        this.ask_multiple=false;
      }
    this.showModal = !this.showModal;  
  }
  initArea(){
    return this.fb.group({
      id:[''],
      restaurant:[this.restaurant,Validators.required],
      name:['',Validators.required],
      description:[''],
      outdoor_seating:[true],
      smoking_zone:[true],
      available:[true],
      create_tables: [true],
    consideration: ["range"],
      start:['',[Validators.required,Validators.pattern('^[1-9]\\d*$')]],
      end:['',[Validators.required,Validators.pattern('^[1-9]\\d*$')]]
      //tables:this.fb.array([])
    }, {
      validators: this.minLessThanMax('start', 'end')
    })
  }
  minLessThanMax(minKey: string, maxKey: string) {
    return (group: AbstractControl) => {
      const min = group.get(minKey)?.value;
      const max = group.get(maxKey)?.value;
      return (min && max && min > max) ? { minGreaterThanMax: true } : null;
    };
  }
  editArea(area:GroupedTableAreas){
    this.DiningAreaForm=this.initArea();  
    this.DiningAreaForm.patchValue(area.dining_area);
    /* //this.DiningAreaForm.patchValue({start:area.start_time,end:area.end_time})
    this.DiningAreaForm.patchValue({consideration:area.consideration})
    this.DiningAreaForm.patchValue({create_tables:area.create_tables})
    this.DiningAreaForm.patchValue({id:area.id})
    this.isSingleArea = false; */
    this.showModal = !this.showModal;
  }
  preventInvalidInput(event: KeyboardEvent) {
    if (['e', 'E', '-', '+'].includes(event.key)) {
      event.preventDefault();
    }
  }

  diningAreas = [
    {
      restaurant: "c491d360-3f56-41b1-8fbe-b1b1989c1528",
      name: "Main Hall",
      description: "The main dining area for regular guests.",
      outdoor_seating: false,
      smoking_zone: false,
      tables: [
        { name: "Table 1", outdoor: false, smokingArea: false },
        { name: "Table 2", outdoor: false, smokingArea: true },
        { name: "Table 3", outdoor: true, smokingArea: false }
      ]
    },
    {
      restaurant: "c491d360-3f56-41b1-8fbe-b1b1989c1528",
      name: "Patio",
      description: "Outdoor seating with fresh air.",
      outdoor_seating: true,
      smoking_zone: true,
      tables: [
        { name: "Table 4", outdoor: true, smokingArea: true },
        { name: "Table 5", outdoor: true, smokingArea: false }
      ]
    },
    {
      restaurant: "c491d360-3f56-41b1-8fbe-b1b1989c1528",
      name: "VIP Lounge",
      description: "Exclusive area for VIP guests.",
      outdoor_seating: false,
      smoking_zone: false,
      tables: [
        { name: "Table 6", outdoor: false, smokingArea: false }
      ]
    }
  ];

  addTable(areaIndex: number,area:DiningArea) {
    this.TableForm=this.initTableForm();
    this.TableForm.patchValue({dining_area:area.id})
    if(this.list&&this.list[areaIndex].isCollapsed){
    this.list[areaIndex].isCollapsed=false;
    }
    this.showModal = !this.showModal;
/*     const newTable = {
      name: `Table ${this.diningAreas[areaIndex].tables.length + 1}`,
      outdoor: this.diningAreas[areaIndex].outdoor_seating,
      smokingArea: this.diningAreas[areaIndex].smoking_zone
    }; */
   // this.diningAreas[areaIndex].tables.push(newTable);
  }

  removeTable(areaIndex: number, tableIndex: number) {
    this.diningAreas[areaIndex].tables.splice(tableIndex, 1);
  }
  onSubmitArea(){
    this.saving=true;
    this.api.postPatch('restaurant-setup/diningareas/',this.DiningAreaForm.value,this.DiningAreaForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
this.closeModal();
this.loadAreas();
this.saving=false;
      },
     error:(err)=>{
      this.saving=false
    //  alert(err)
     }
      //console.log(x)
    })
  }
  isSubmitting=false;
DeleteArea(area:DiningArea){
    const ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      reason_required:true,
      //action_info:'This table will no longer be available for booking',
      message:'Are you sure you want to <strong>Delete</strong> Dining Area - '+ area.name +'? <br> Please provide the reason for deleting the section.',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('restaurant-setup/diningareas/',{id:area.id,deletion_reason:x?.reason}).subscribe({
          next: ()=>{
      this.loadAreas();
      this.dialog.closeModal();
      ref.unsubscribe();
          },
          error:(err)=>{
           // alert(err)
          }
        });
        //this.dialog.closeModal();
      }
      if(x?.action=='no'||x?.action=='reject'){
        
        this.dialog.closeModal();
        ref.unsubscribe();
      }      
    });  
  }
    AreaAvailabilityChange(event:any,a:DiningArea,index:number){
   
  const ref =this.dialog.openModal(
    {
      title:'CONFIRMATION',
  message:"Are you sure you want to change the availability of "+a.name+ " to <b>"+(a.available?"available":"not available") +"</b> ?",
  
  }).subscribe((x:any)=>{
  if(x?.action=='yes'){
    this.api.postPatch('restaurant-setup/diningareas/',{id:a.id,available:event.target.checked},'put','',{},false,'',true).subscribe({
      next: ()=>{
        this.loadAreas();
       
  this.dialog.closeModal();
  ref?.unsubscribe();
      }
     
      //console.log(x)
    })
  }
  if(x?.action=='no'){
    if(this.list?.length){
this.list[index].dining_area.available=!this.list[index].dining_area.available
    }
    
   
       // this.loadMenuItems(this.section?.id as string);
  /*  this.loadMenuItems(this.section?.id as string);
   this.loadSections(); */
   this.dialog.closeModal();
  ref?.unsubscribe();
  }
  })
  
   }
   openInNewWindow(id:any) {
    const url = this.router.serializeUrl(
      this.router.createUrlTree(['/rest-app/rest-app-ordering/h/',id]) // Replace with your component's route
    );
    window.open(url, '_blank', 'width=800,height=600');
  }
currentTable?:DiningAreaTable;
currentTableIndex?:number;
  isOpen = false;
  menuItems = [];
 tableId: number = 1;

  closeMenu() {
    this.isOpen = false;
    this.sessionStorage.clear();
    this.basketService.clearBasket();
    this.loadAreas(this.currentTable?.id,this.currentTableIndex as number);
    //this.sessionStorage.removeItem('Table');
    //this.sessionStorage.removeItem('Basket');
  }
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.router.navigate(this.auth.currentRestaurantRole?.restaurant_id?['/rest-app/dining-tables']:['/mgt-app/restaurants/rest-app',this.restaurant,'dining-tables']);
     //
     //  console.log('Escape key pressed!');
      this.closeMenu();
    }
  }


  addItem(item: any) {
    // Implement order submission logic
  }

    isMenuOpen = false;
    selectedTable = ''
    menuData = [
      { name: 'Burger' },
      { name: 'Pasta' },
      { name: 'Salad' },
    ];
  
    openMenu(table: DiningAreaTable,areaIndex:number) {
      this.selectedTable = table.id;
      this.currentTable = table;
      this.currentTableIndex = areaIndex;
      this.tableId = table.number;
      this.isOpen = true;
      this.sessionStorage.setItem('restaurant', this.auth.currentRestaurant?.id?this.auth.currentRestaurant: this.current_restaurant);
      this.sessionStorage.setItem('Table',table);
    }
    toggleAvailability($event:any,table: DiningAreaTable,areaIndex:number,tableIndex:number): void {
      const ref =this.dialog.openModal(
        {
          title:'CONFIRMATION',
      message:"Are you sure you want to change the availability of Table "+table.number+ " to <b>"+(!table.enabled?"available":"not available") +"</b> ?",
      
      }).subscribe((x:any)=>{
        if(x?.action=='yes'){
      this.api.postPatch('restaurant-setup/tables/',{id:table.id, enabled: $event.target.checked},'put','',{},false,'',true).subscribe({
        next: ()=>{
          this.loadAreas(null as any,areaIndex);
          this.dialog.closeModal();
          ref?.unsubscribe();
        }
      });

    }
    if(x?.action=='no'){
      this.list![areaIndex].tables[tableIndex].enabled = !this.list![areaIndex].tables[tableIndex].enabled;
ref?.unsubscribe();
    }
    })
  }
  isToday(date_:any){
    // Get today's date
    const today = new Date();
    const dateToCheck= new Date(date_);
  
    // Compare the components of the dateToCheck with today's date
    const isSameDate =
        dateToCheck.getDate() === today.getDate() &&
        dateToCheck.getMonth() === today.getMonth() &&
        dateToCheck.getFullYear() === today.getFullYear();
  
    // Return true if the dateToCheck is today, otherwise return false
    return isSameDate;
  }
  DeleteItem(item:OrderedItem){
    const ref = this.dialog.openModal({
      title:'Delete',
      has_reason:true,
      submitButtonText:'Delete',
      cancelButtonText:'Cancel',
      message:'Are you sure you want to <strong>Delete</strong> '+item?.item.name+' from Order #'+this.order?.order_number +'? <br> Please the reason for deleteing is required',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.Delete('orders/add-items/',{item:item.id,reason:x?.reason},'v2').subscribe({
          next: ()=>{
    //  this.loadOrders(this.restaurant,true);
      
      this.dialog.closeModal();
      ref.unsubscribe();
          }
        });
        //this.dialog.closeModal();
      }
      if(x?.action=='no'){
        this.dialog.closeModal();
        ref.unsubscribe();
      }


    });


  }
  ViewMenu(){
    this.view_menu=true;
    this.showModal=true;  
   }
   EditMenu(t:DiningAreaTable){
    this.api.get<any>(null,'orders/details/',{order:t.available?.order_id},'v2').subscribe((x)=>{
      this.order=x?.data as any;     
      this.edit_menu=true;
      this.showModal=true;
   
    })
    this.edit_menu=true;
    this.showModal=true;
   }
   SaveNewItem(item:any){
    const ref = this.dialog.openModal({
      title:'Add Item',
      submitButtonText:'Add',
      message:'Are you sure you want to <strong>Add</strong> '+item?.itemName+' to order #'+this.order?.order_number +' ?',
    })?.subscribe((x:any)=>{
      if(x?.action=='yes'){
        this.api.postPatch('orders/add-items/',{order:this.order?.id,items:[item]},'post','',{},false,'v2').subscribe({
          next: ()=>{
   //   this.loadOrders(this.restaurant,true);
      
      this.dialog.closeModal();
      ref.unsubscribe();
   //   this.CLoseMenu();
      
          }
        });
        //this.dialog.closeModal();
      }
      if(x?.action=='no'){
        this.dialog.closeModal();
        ref.unsubscribe();
      }
    })
  }
  CLoseMenu(){
    this.view_menu=false;
    this.edit_menu=true;
   // this.PaymentForm!=null;
   }
}
