import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Account, RestaurantDetail, TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

@Component({
    selector: 'app-payments',
    templateUrl: './payments.component.html',
    styleUrls: ['./payments.component.css'],
    providers: [DatePipe],
    standalone: false
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
  today=this.datePipe.transform(Date.now(),'yyyy-MM-dd') as any;
  /**
   *
   */
  constructor(private datePipe:DatePipe, private api:ApiService, private fb:FormBuilder) {
 
    this.getList();
  }
  getList(){
    this.api.get<any>(null,`reports/restaurant/`+'transactions-listing/',{from:this.today,to:this.today}).subscribe((x)=>{
      /* this.list=x?.data?.records as any[];  */    
      this.acc= this.rest?.account
  this.list=x?.data as any;
  })
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
    this.api.postPatch('users/auth/resend-otp/',{"identification": identification, "identifier": identifier,"purpose": purpose},'post').subscribe(_x=>{
      this.require_otp=true
      // store user details and jwt token in local storage to keep user logged in between page refreshes
      //  localStorage.setItem('user', JSON.stringify((response.data)));
      //  this.userSubject.next(response.data as any)
       
    });
  }
}
