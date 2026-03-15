import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Message, RestaurantDetail, TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MessageService } from 'src/app/_services/message.service';

@Component({
  selector: 'app-billing',
  templateUrl: './billing.component.html',
  styleUrl: './billing.component.css'
})
export class BillingComponent {
rest?:RestaurantDetail;
  rest_id: any;
  showModal=false;
  PaymentForm?:FormGroup;
  require_otp=false;
  data='';
  sub_details?:{subscription_validity:boolean,subscription_expiry_date:any};
BillingForm?:FormGroup;
date_now=Date.now();
transaction_list: TransactionListItem[]=[];

constructor(private auth:AuthenticationService,private route:ActivatedRoute,private api:ApiService,private fb:FormBuilder,private message:MessageService) {
  if(auth.currentRestaurantRole?.restaurant_id){
    this.rest=this.auth.currentRestaurant;
    this.rest_id = this.rest.id;
    this.loadingBillingSub();
    this.getTransactionList();
  
  }else if(this.route.parent?.parent?.snapshot.params['id']){
    this.rest_id=this.route.parent?.parent?.snapshot.params['id'];
    this.loadRestaurant(this.rest_id);
    this.loadingBillingSub();
    this.getTransactionList();
  }  
this.route.params.subscribe(x=>{
 if(x['id']){
  ///// PopUp Payment Status
 }
})
}
AddDate(){
  this.BillingForm=this.fb.group({    
    restaurant:[this.rest_id],
      subscription_validity:[true],
      subscription_expiry_date:[null,[Validators.required]]
  })
  this.showModal=true;
}
SaveDate(){
  this.api.postPatch('restaurant-setup/subscription-details/',this.BillingForm?.value,'put',null,{restaurant:this.rest_id}).subscribe((x:any)=>{
        
    if(x.status==200){
      const mes:Message={
        message:x.message,
        severity:'info',
        summary:''
      }
      this.message.addMessage(mes);
      //this.message.add(mes);
      this.loadRestaurant(this.rest_id);
      this.closeModal();
      //this.router.navigate(['/diner','payment-details',res.transaction_id])
    }
   //
  })
}
subtractMonths(date: Date, monthsToSubtract: number): Date {
  const dateCopy = new Date(date);
  dateCopy.setMonth(dateCopy.getMonth() - monthsToSubtract);
  return dateCopy;
}
load_list=false;
getTransactionList(){
  this.load_list=false;
  const today = new Date();
  const from_today = this.subtractMonths(today,5);
  this.api.get<any>(null,`reports/restaurant/`+'transactions-listing/',{restaurant:this.rest_id,from:`${from_today.getFullYear()}-${from_today.getMonth() + 1}-${from_today.getDate()}`,to:`${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,type:'subscription'}).subscribe((x)=>{
    /* this.list=x?.data?.records as any[];  */    
    if(x?.status==200){
this.transaction_list=x?.data as any;
this.load_list=true;
    }
/*     if(x?.status==400){
      this.messageService.addMessage({severity:'error',summary:'Error',message:x?.message})
     } */
    })
}
loadRestaurant(id:string){
   
  this.api.get<any>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:{})).subscribe((x)=>{
    this.rest=x?.data as any;
  })
}
loadingBillingSub(){
  this.api.get<any>(null,'restaurant-setup/subscription-details/',{restaurant:this.rest_id}).subscribe((x)=>{
   // this.rest=x?.data as any;
   this.sub_details=x?.data as any;
  
  })
}
closeModal(){
  this.showModal=false;
  this.PaymentForm!=null;
  this.data='';
this.require_otp=false;
}
PayNow(){
  this.PaymentForm=this.InitPayment();
  this.showModal=true;
}
InitPayment(){
  return this.fb.group({
    transaction_type: ["subscription"],
    transaction_platform: ["web"],
    payment_mode: [""],
    restaurant_id: [this.rest_id],
    msisdn: [""],
    otp:[]/* ,
    manual_payment_details:this.fb.group({
      telecom:[''],
      transaction_id:['']
    }) */
})
}
Save(){
  if(this.data!=''&& this.require_otp&&this.PaymentForm?.get('payment_mode')?.value=='momo'){
    this.PaymentForm.get('otp')?.setValue(this.data)
    const d= this.PaymentForm.value;
        d.msisdn='256'+ this.PaymentForm.get('msisdn')?.value
    this.api.postPatch('finances/transactions/',d,'post').subscribe((x:any)=>{
        
      if(x.status==200){
        this.message.add(x.message);
        this.closeModal();
      }
     //
    })
  }else if(this.PaymentForm?.get('payment_mode')?.value=='momo'){
    this.api.get<any>(null,'users/msisdn-lookup/?msisdn=256'+this.PaymentForm.get('msisdn')?.value).subscribe((x)=>{
      if(x.status==400){
this.sendOtp('msisdn','256'+this.PaymentForm?.get('msisdn')?.value,null);
      }else if(x.status==200){
        const d= this.PaymentForm?.value;
        d.msisdn='256'+ this.PaymentForm?.get('msisdn')?.value
        this.api.postPatch('finances/transactions/',d,'post').subscribe((x:any)=>{
        
          if(x.status==200){
            this.message.add(x.message);
            this.closeModal();
            
           //window.location.href=res.redirect_url; 
          }
         //
        })
      }
    })
  }else if (this.PaymentForm?.get('payment_mode')?.value=='card'){
    this.api.postPatch('finances/transactions/',this.PaymentForm.value,'post').subscribe((x:any)=>{
        
      const res=x?.data;
      if(x.status==200){
        const mes:Message={
          message:x.message,
          severity:'info',
          summary:''
        }
        this.message.addMessage(mes);
        this.closeModal();
       window.location.href=res.redirect_url; 
      }
     //
    })
  }
}
sendOtp(identification:any,identifier:any,purpose:any){
  this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(_x=>{
    this.require_otp=true 
    // store user details and jwt token in local storage to keep user logged in between page refreshes
    //  localStorage.setItem('user', JSON.stringify((response.data)));
    //  this.userSubject.next(response.data as any)
     
  });
}
get canChangeBillingDate(){
  return this.auth.userValue?.profile.roles.includes('dinify_admin')
}
}
