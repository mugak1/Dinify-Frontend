import { Component } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { OrdersListItem, Restaurant, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';

@Component({
    selector: 'app-orders',
    templateUrl: './orders.component.html',
    styleUrl: './orders.component.css',
    standalone: false
})
export class OrdersComponent {
  restaurant?:Restaurant;
  table!:TableScan;
  current_order!:OrdersListItem;
  PaymentForm!:FormGroup;
  require_otp=false;
  data='';
/**
 *
 */
constructor(private sessionStorage:SessionStorageService,private api:ApiService,private fb:FormBuilder,private router:Router) {
  this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  this.table=this.sessionStorage.getItem<TableScan>('Table') as any;
  if(this.table?.current_order){
    this.loadCurrentOrder(this.table?.current_order?.order_id);
    this.PaymentForm= this.InitPaymentForm(this.table?.current_order?.order_id);
    this.SetChanges();
  }else{
    this.PaymentForm= this.InitPaymentForm(null);
  }
}
loadCurrentOrder(id:any){
  this.api.get<any>(null,'orders/journey/order-details/',({order:id})).subscribe((x)=>{
    if(id){
this.current_order=x?.data as any;
    }
    
  })
}
InitPaymentForm(id:any){
  return this.fb.group({
    
      order: id,
      payment_mode: ["momo"],
      platform: "web",
      payment_form: "full",
      msisdn: [],
      amount: [],
      add_tip:[false],
      tip_select:[''],
      tip_amount:[],
      otp:['']
  
  })
}

SetChanges(){
  this.PaymentForm.get('add_tip')?.valueChanges.subscribe(x=>{
if(!x){
  this.PaymentForm.get('tip_select')?.setValue('')
  this.PaymentForm.get('tip_amount')?.setValue('')
}
  })
  this.PaymentForm.get('tip_select')?.valueChanges.subscribe(x=>{
    const baseCost = this.current_order?.actual_cost ?? 0;
    if(x==10){
      this.PaymentForm.get('tip_amount')?.setValue(baseCost*0.1)
    }
    if(x==15){
      this.PaymentForm.get('tip_amount')?.setValue(baseCost*0.15)
    }
    if(x==20){
      this.PaymentForm.get('tip_amount')?.setValue(baseCost*0.2)
    }
    if(x=='Other'){
      this.PaymentForm.get('tip_amount')?.setValue('')
    }
  })
}

Save(){
  if(this.data!=''&& this.require_otp&&this.PaymentForm.get('payment_mode')?.value=='momo'){
    this.PaymentForm.get('otp')?.setValue(this.data)
    const d= this.PaymentForm.value;
        d.msisdn='256'+ this.PaymentForm.get('msisdn')?.value
    this.api.postPatch('finances/initiate-order-payment/',d,'post').subscribe((x:any)=>{

      const res=x?.data;
      if(x?.status==200 && res?.transaction_id){
        this.router.navigate(['/diner','payment-details',res?.transaction_id])
      }
     //
    })
  }else if(this.PaymentForm.get('payment_mode')?.value=='momo'){
    this.api.get<any>(null,'users/msisdn-lookup/?msisdn=256'+this.PaymentForm.get('msisdn')?.value).subscribe((x)=>{
      if(x.status==400){
this.sendOtp('msisdn','256'+this.PaymentForm.get('msisdn')?.value,null);
      }else if(x.status==200){
        const d= this.PaymentForm.value;
        d.msisdn='256'+ this.PaymentForm.get('msisdn')?.value
        this.api.postPatch('finances/initiate-order-payment/',d,'post').subscribe((x:any)=>{

          const res=x?.data;
          if(x?.status==200 && res?.transaction_id){

              this.router.navigate(['/diner','payment-details',res?.transaction_id])

           //window.location.href=res.redirect_url;
          }
         //
        })
      }
    })
  }else if (this.PaymentForm.get('payment_mode')?.value=='card'){
    this.api.postPatch('finances/initiate-order-payment/',this.PaymentForm.value,'post').subscribe((x:any)=>{

      const res=x?.data;
      if(x?.status==200 && res?.redirect_url){
       window.location.href=res?.redirect_url;
      }
     //
    })
  }
/*   this.api.postPatch('finances/initiate-order-payment/',this.PaymentForm.value,'post').subscribe((x:any)=>{
        
      let res=x?.data;
      if(x.status==200){
       window.location.href=res.redirect_url; 
      }
     // 
    console.log(x);
    }) */
}
sendOtp(identification:any,identifier:any,purpose:any){
  this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(_x=>{
    this.require_otp=true
    // store user details and jwt token in local storage to keep user logged in between page refreshes
    //  localStorage.setItem('user', JSON.stringify((response.data)));
    //  this.userSubject.next(response.data as any)
     
  });
}
}
