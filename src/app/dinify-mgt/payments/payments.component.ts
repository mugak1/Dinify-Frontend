import { DatePipe } from '@angular/common';
import { Component } from '@angular/core';
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
    rest?:RestaurantDetail;
    acc?:Account;
  list?:TransactionListItem[]=[];
  today=this.datePipe.transform(Date.now(),'yyyy-MM-dd') as any;
  /**
   *
   */
  constructor(private datePipe:DatePipe, private api:ApiService) {
 
    this.getList();
  }
  getList(){
    this.api.get<any>(null,`reports/restaurant/`+'transactions-listing/',{from:this.today,to:this.today}).subscribe((x)=>{
      /* this.list=x?.data?.records as any[];  */    
      this.acc= this.rest?.account
  this.list=x?.data as any;
  })
  }
}
