import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { OrderedItem, OrdersListItem, RestaurantDetail } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MessageService } from 'src/app/_services/message.service';
import { formatDistanceToNow } from 'date-fns';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css'
})
export class OrdersComponent implements OnDestroy {
restaurant?: any;
order_statuses=['pending','preparing','cancelled']
list?:OrdersListItem[]=[];
list_cache?:OrdersListItem[]=[];
order?:OrdersListItem;
current_order_status:string='';
showModal=false;
PaymentForm!:FormGroup;
view_menu:boolean=false;
edit_menu=false;
tabs=['active','closed','all']
active_tab=this.tabs[0];
require_otp=false;
data='';
is_saving=false;
totalBalancePayable: number = 0;
otpExpired = false;
otpInvalid = false;
isResending = false;
isVerifying = false;
otpTimer = 0;
otpCountdownInterval: any;
viewMode: 'kanban' | 'table' = 'kanban';
restaurant_details:RestaurantDetail|null=null;
  /**
   *
   */
  constructor(private auth:AuthenticationService, private api:ApiService,private route:ActivatedRoute, private dialog:ConfirmDialogService, private fb:FormBuilder, private message:MessageService) {
   
    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
      this.restaurant_details=auth.currentRestaurant;
      this.current_order_status=this.order_statuses[0]
      this.loadOrders(this.restaurant)
    }else  if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
      this.loadRestaurantDetails(this.restaurant)
      this.current_order_status=this.order_statuses[0]
      this.loadOrders(this.restaurant)
    }
    
  }
  loadRestaurantDetails(restaurant_id:any){
   this.api.get<RestaurantDetail>(null,'restaurant-setup/'+'details/',{id:restaurant_id,record:'restaurants'}).subscribe((x:any)=>{
  this.restaurant_details=x.data
})
  }
  SetTab(ac:number){
    this.active_tab=this.tabs[ac];
    this.api.get<any>(null,'restaurant-setup/orders/',{restaurant:this.restaurant,status:this.active_tab}).subscribe((x)=>{
      this.list=[];
      this.order=null as any;
      this.list=x?.data?.records as OrdersListItem[];
      this.list_cache = [...this.list]; // Cache the original list
      if(this.list?.length>0){
       
         this.order=this.list[0];
       
       
      }
      
   //this.menu_item=x?.data?.records[0];
       
     })
  }
  loadOrders(restaurant:string,selected_id?:boolean){  
    this.api.get<any>(null,'restaurant-setup/orders/',this.active_tab?{restaurant:this.restaurant,status:this.active_tab}:{restaurant:this.restaurant}).subscribe((x)=>{
     this.list=x?.data?.records as OrdersListItem[];
      this.list_cache = [...this.list]; // Cache the original list
     if(this.list?.length>0){
      if(selected_id){
        this.order= this.list.find(o=>o.id==this.order?.id)
      }else{
        this.order=this.list[0];
      }
      
     }
     
  //this.menu_item=x?.data?.records[0];
      
    })

 }
 ViewMenu(){
  this.view_menu=true;
  this.showModal=true;  
 }
 CLoseMenu(){
  this.view_menu=false;
  this.edit_menu=true;
  this.PaymentForm!=null;
 }
 EditMenu(){
  this.edit_menu=true;
  this.showModal=true;
 }
 changeStatus(status:string,id?:any,menu_item_name?:string){
  let mes = ''
  let buttonText='';
  let titleText='';
  switch(status){
   case 'cancel':
mes='Are you sure you want to <strong>Decline</strong> Order #'+this.order?.order_number+' ?';
      buttonText='Decline';
     break;
     case 'served':
      titleText='Serve Order'
      mes='Are you sure '+menu_item_name+' is <strong>Served</strong> ?';
      buttonText='Yes';
      break;
    case 'preparing':
      mes='Are you sure you want to <strong>ACCEPT</strong> Order #'+this.order?.order_number+' ?';
      buttonText='Accept';
      break;
     default:
mes='Are you sure you want to set Order #'+this.order?.order_number+' to <strong>'+status.toUpperCase()+'</strong> ?';
     break;

  }
 const ref = this.dialog.openModal({
    title:titleText? titleText:'Track Order',
    message:mes,
    submitButtonText:buttonText,
  }).subscribe((x:any)=>{
   
    if(x?.action=='yes'){
  /*     if(this.order?.items?.length as number>1){

      }else{ */
/**/          this.api.postPatch('orders/update-item/',{item_id:id?id:this.order?.items[0].id,status:status},'put').subscribe({
          next: ()=>{
      this.loadOrders(this.restaurant);
      this.dialog.closeModal();
      ref.unsubscribe();
          }
        }); 
         
          //console.log(x)
        } 
      //}
  })


 }
 AcceptOrder(id?:any){
  const ref = this.dialog.openModal({
     title:'Accept Order',
     submitButtonText:'Accept',
     message:'Are you sure you want to <strong>ACCEPT</strong> Order #'+this.order?.order_number+' ?',
   })?.subscribe((x:any)=>{
     if(x?.action=='yes'){
 /**/          this.api.postPatch('orders/prepare/',{order:id},'put').subscribe({
           next: ()=>{
       this.loadOrders(this.restaurant);
       
       this.dialog.closeModal();
       ref.unsubscribe();
           }
         }); 
          
           //console.log(x)
         } 
     
   })
   
 
  }
  CancelOrder(id?:any){
    const ref = this.dialog.openModal({
       title:'Decline Order',
       submitButtonText:'Decline',
       message:'Are you sure you want to <strong>Decline</strong> Order #'+this.order?.order_number+' ?',
     })?.subscribe((x:any)=>{
       if(x?.action=='yes'){
   /**/          this.api.postPatch('orders/cancel/',{order:id},'put').subscribe({
             next: ()=>{
         this.loadOrders(this.restaurant);
         
         this.dialog.closeModal();
         ref.unsubscribe();
             }
           }); 
            
             //console.log(x)
           } 
       
     })
     
   
    }
 closeModal(){
  this.showModal=false;
  this.view_menu=false;
  this.PaymentForm=null as any;
  this.edit_menu=false;
}
InitiateManualPayment(id:any){
  this.PaymentForm= this.InitPaymentForm(id);
  this.totalBalancePayable=Number(this.order?.balance_payable);
  this.loadOrderDetails(id);
  this.showModal=true;
}
loadOrderDetails(id:any){
  this.api.get<any>(null,'orders/details/',{order:id},'v2').subscribe((x:any)=>{
    this.totalBalancePayable= Number(x.data.balance_payable)
  })
}
InitPaymentForm(id:any){
  return this.fb.group({
    
      order: id,
      payment_mode: ["cash"],
      platform: "web",
      payment_form: "full",
      msisdn: [''],
      amount: [],
      manual_payment:[true],
      otp:[''],
      manual_payment_details:this.fb.group({
        telecom:[''],
        transaction_id:['']
      })
  })
}
Save(){
  this.is_saving=true;
  if(!this.require_otp&&this.data==''){
    this.sendOtp("msisdn",this.auth.userValue?.profile.phone_number,null);
  }else{
this.PaymentForm.get('otp')?.setValue(this.data)
  this.api.postPatch('finances/initiate-order-payment/',this.PaymentForm.value,'post').subscribe((x:any)=>{
        this.message.add(x?.message);
        this.showModal=false;
    /*   let res=x?.data;
      if(x.status==200){
       window.location.href=res.redirect_url; 
      } */
     // 
    })
  }
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
    this.loadOrders(this.restaurant,true);
    
    this.dialog.closeModal();
    ref.unsubscribe();
    this.CLoseMenu();
    
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
    this.loadOrders(this.restaurant,true);
    
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
getTimeAgo(time: string): string {
  return formatDistanceToNow(new Date(time), { addSuffix: true });
}

ChangeOrder(o:any){
  const ord=o.value;
  switch(ord){
  case 'n-o':{
this.list=this.list_cache?.sort((a:OrdersListItem,b:OrdersListItem)=>{ return +new Date(a.time_created)- +new Date(b.time_created);})
    break;
  }
  case 'o-n':{
    this.list=this.list_cache?.sort((a:OrdersListItem,b:OrdersListItem)=>{ return +new Date(b.time_created)- +new Date(a.time_created);})
        break;
      }
      case 't-a':{
        this.list=this.list_cache?.sort((a:OrdersListItem,b:OrdersListItem)=>{ return a.table_details.table_number-b.table_details.table_number})
            break;
          } 
          case 't-d':{
            this.list=this.list_cache?.sort((a:OrdersListItem,b:OrdersListItem)=>{ return b.table_details.table_number-a.table_details.table_number;})
                break;
              }
               case 'specials': {
      this.list = this.list_cache?.filter((item: OrdersListItem) => item.items.some(i => i.item.is_special));
      break;
    }

  default:{
break;
  }
}
}
sendOtp(identification:any,identifier:any,purpose:any){
  this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(_x=>{
    this.require_otp=true
    this.startOTPTimer(); // Start the OTP timer
    // store user details and jwt token in local storage to keep user logged in between page refreshes
    //  localStorage.setItem('user', JSON.stringify((response.data)));
    //  this.userSubject.next(response.data as any)
     
  });
}
startOTPTimer(seconds: number = 60) {
  this.otpTimer = seconds;
  clearInterval(this.otpCountdownInterval);
  this.otpCountdownInterval = setInterval(() => {
    if (this.otpTimer > 0) {
      this.otpTimer--;
    } else {
      clearInterval(this.otpCountdownInterval);
      this.otpExpired = true;
    }
  }, 1000);
}

resendOTP() {
  this.isResending = true;
  this.otpExpired = false;
  this.otpInvalid = false;

  // Simulate resend
  setTimeout(() => {
    this.isResending = false;
    this.startOTPTimer(); // restart timer after resend
  }, 2000);
}

verifyOTP() {
  this.isVerifying = true;
  setTimeout(() => {
    this.isVerifying = false;
    // simulate OTP check result
    const isValid = Math.random() > 0.3;
    if (!isValid) {
      this.otpInvalid = true;
    } else {
      // success: complete payment
    }
  }, 1500);
}

ngOnDestroy() {
  clearInterval(this.otpCountdownInterval);
}
goBackToPaymentForm() {
  this.require_otp = false;
  this.otpInvalid = false;
  this.otpExpired = false;
  this.data = ''; // Reset OTP input
  clearInterval(this.otpCountdownInterval);
  this.otpTimer = 0;
}

get groupedOrders() {
  const groups: { [key: string]: any[] } = {};
  for (const order of this.list??[]) {
    const status = order.order_status || 'unknown';
    if (!groups[status]) {
      groups[status] = [];
    }
    groups[status].push(order);
  }
  return groups;
}
getKeys(obj: any): string[] {
  return Object.keys(obj);
}
printReceipt() {
  const receiptEl = document.querySelector('.dot-matrix-receipt');
  if (!receiptEl) return;

  const popupWin = window.open('', '_blank', 'width=400,height=600');
  if (!popupWin) return;

  const doc = popupWin.document;
  doc.open();

  // Build document safely via DOM APIs instead of document.write with interpolated HTML
  doc.write('<!DOCTYPE html><html><head><title>Receipt</title></head><body></body></html>');
  doc.close();

  const style = doc.createElement('style');
  style.textContent = `
    @media print {
      .no-print { display: none !important; }
      .print\\:block { display: block !important; }
    }
    .dot-matrix-receipt {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      width: 280px;
      margin: 0 auto;
      padding: 0;
      background: white;
      color: black;
    }
  `;
  doc.head.appendChild(style);

  const container = doc.createElement('div');
  container.id = 'printable-receipt';
  // Clone the receipt node to avoid injecting raw innerHTML from potentially untrusted content
  const cloned = receiptEl.cloneNode(true);
  container.appendChild(cloned);
  doc.body.appendChild(container);

  popupWin.onload = () => {
    popupWin.print();
    popupWin.close();
  };
  // Fallback: if onload already fired (some browsers)
  popupWin.setTimeout(() => {
    popupWin.print();
    popupWin.close();
  }, 250);
}
}

