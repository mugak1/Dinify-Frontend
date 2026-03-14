import { DatePipe } from '@angular/common';
import { Component} from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Account, RestaurantDetail, TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';

@Component({
  selector: 'app-payments',
  templateUrl: './payments.component.html',
  styleUrl: './payments.component.css',
  providers:[DatePipe]
})
export class PaymentsComponent {
require_otp=false;
data='';
PaymentForm?:FormGroup;
  restaurant?: string;
  showModal=false;
  rest?:RestaurantDetail;
  acc?:Account;
  list?:TransactionListItem[]=[];
  today?:Date;
/**
 *
 */
constructor(private fb:FormBuilder,private auth:AuthenticationService,private route:ActivatedRoute,private api:ApiService,private datePipe:DatePipe) {
  if(auth.currentRestaurantRole?.restaurant_id){
    this.restaurant=auth.currentRestaurantRole?.restaurant_id;
this.loadRestaurant(this.restaurant);
   // this.enc_restaurant=btoa(this.restaurant)
    // this.loadReviews()
  }else 
  if(this.route.parent?.snapshot.params['id']){
    this.restaurant=this.route.parent?.snapshot.params['id'];
    this.loadRestaurant(this.restaurant as any)
   // this.enc_restaurant=btoa(this.restaurant)
    //  this.loadReviews();
  }
  
}
InitPayment(){
  return this.fb.group({
    "transaction_type": ["disbursement"],
    "transaction_platform": ["web"],
    "payment_mode": ["momo"],
    "restaurant": [this.restaurant],
    "amount": [""],
    "otp": [""]
  });
}
DisburseNow(){
  this.PaymentForm=this.InitPayment();
  this.showModal=true;
}
closeModal(){
  this.showModal=false;
  this.PaymentForm!=null;
  this.data='';
this.require_otp=false;
}
Save(){

}
sendOtp(identification:any,identifier:any,purpose:any){
  this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(x=>{
    this.require_otp=true 
    // store user details and jwt token in local storage to keep user logged in between page refreshes
    //  localStorage.setItem('user', JSON.stringify((response.data)));
    //  this.userSubject.next(response.data as any)
     
  });
}
getList(){
  this.api.get<any>(null,`reports/restaurant/`+'transactions-listing/',{restaurant:this.restaurant,from:this.today,to:this.today}).subscribe((x)=>{
    /* this.list=x?.data?.records as any[];  */    
this.list=x?.data as any;
})
}
loadRestaurant(id:string){
   
  this.api.get<RestaurantDetail>(null,'restaurant-setup/'+(id?'details/':'restaurants/'),(id?{id:id,record:'restaurants'}:{})).subscribe((x)=>{
    
this.rest=x?.data as any;
this.acc= this.rest?.account
this.today=this.datePipe.transform(Date.now(),'yyyy-MM-dd') as any;
this.getList();
  
    
  })
}
}
