import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ChartData, SalesReportListItem, SalesTrendListItem, TransactionListItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { MessageService } from 'src/app/_services/message.service';


@Component({
  selector: 'app-report-detail',
  templateUrl: './report-detail.component.html',
  styleUrl: './report-detail.component.css'
})
export class ReportDetailComponent {

  /**
   *
   */
  list:SalesReportListItem[]=[];
  trend_list:SalesTrendListItem[]=[];
  restaurant: any;
  summary:any[]=[];
  report_type:any;
  date_to:any='2024-12-30';
  date_from:any='2024-12-01';
  category:any='';
  category_field='';
  Names:any={
    "number_of_sales": 'Number of Sales',
    "gross_sales_amount": "Gross Sales Amount",
    "sales_by_payment_channel": "No. Sales By Channel",
    "sales_amount_by_payment_channel": "Amount by Channel",
    "average_order_amount": "Average Order Amount",
    "maximum_order_amount": "Maximum Order Amount",
    "minimum_order_amount": "Minimum Order Amount",
    "total_discounts_offered": "Total Discounts Offered",
    "no_of_transactions":"Number of Transactions",
    "transaction_status_overview":"Transaction Status",
    "transaction_type_overview":"Transaction Types",
    "new_diners": "New Diners",
    "repeat_diners": "Repeat Diner",
    "most_active_diner": "Most Active Diner",
    "average_sales_amount_per_diners": "Avg. Amount per diner"
}
transactions={      
"no_of_transactions": 0,
"transaction_status_overview": [
    {
        "status": "success",
        "count": 0,
        "amount": 0
    },
    {
        "status": "failed",
        "count": 0,
        "amount": 0
    },
    {
        "status": "pending",
        "count": 0,
        "amount": 0
    },
    {
        "status": "initiated",
        "count": 0,
        "amount": 0
    }
],
"transaction_type_overview": [
    {
        "transaction_type": "order_payment",
        "count": 0
    },
    {
        "transaction_type": "order_refund",
        "count": 0
    },
    {
        "transaction_type": "order_charge",
        "count": 0
    },
    {
        "transaction_type": "disbursement",
        "count": 0
    },
    {
        "transaction_type": "subscription",
        "count": 0
    }
]
}
  transaction_list: TransactionListItem[]=[];
  chart_data: ChartData|undefined;
  constructor(private auth:AuthenticationService, private api:ApiService,private route:ActivatedRoute,private messageService:MessageService) {
    
   this.report_type= this.route.snapshot.params['type'];
   if(auth.currentRestaurantRole?.restaurant_id){
    this.restaurant=auth.currentRestaurantRole?.restaurant_id;
   
  }else if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
    }

    switch(this.report_type){
      case 'sales':
       // this.category_field='number_of_sales';
        this.getList(); 
        break;
      case 'transactions':
this.getTransactionList();
this.getTransactionSummary();
break;
case 'menu':
this.getMenuReport()
break;
    }
   /*  if(this.report_type!='menu'){
        

    } */

   // this.getSummary();
    //this.category='daily';
   // this.getTrendChart();
  }
  getMenuReport(){    
    this.api.get<any>(null, `reports/restaurant/` + this.report_type + `-summary/`, { restaurant: this.restaurant, from: this.date_from, to: this.date_to }).subscribe((x) => {
      /* this.list=x?.data?.records as any[];  */
      if (x?.status == 200) {
        this.reportData = x?.data;
        
        const summ: any = x?.data
        /* if (summ) {
          Object.keys(summ).forEach(x => {
            this.summary.push({ name: x, value: summ[x] });
          })
        } */
      }
      if (x?.status == 400) {
        this.messageService.addMessage({ severity: 'error', summary: 'Error', message: x?.message })
      }
    })
  }
  getSummary() {
    this.category = this.category_field;
    this.api.get<any>(null, `reports/restaurant/` + this.report_type + `-summary/`, { restaurant: this.restaurant, from: this.date_from, to: this.date_to }).subscribe((x) => {
      /* this.list=x?.data?.records as any[];  */
      if (x?.status == 200) {
        this.summary = [];
        const summ: any = x?.data
        if (summ) {
          Object.keys(summ).forEach(x => {
            this.summary.push({ name: x, value: summ[x] });
          })
        }
      }
      if (x?.status == 400) {
        this.messageService.addMessage({ severity: 'error', summary: 'Error', message: x?.message })
      }
    })
  }
  getList(){
    this.api.get<any>(null,`reports/restaurant/`+this.report_type+'-listing/',{restaurant:this.restaurant,from:this.date_from,to:this.date_to}).subscribe((x)=>{
      /* this.list=x?.data?.records as any[];  */    
      if(x?.status==200){
this.list=x?.data as any;
      }
      if(x?.status==400){
        this.messageService.addMessage({severity:'error',summary:'Error',message:x?.message})
       }
  })
}

getTrend(){
  this.getTrendChart();
  this.api.get<any>(null,`reports/restaurant/`+this.report_type+'-trends/',{restaurant:this.restaurant,from:this.date_from,to:this.date_to,category:this.category,result:'table'}).subscribe((x)=>{
    /* this.list=x?.data?.records as any[];  */ 
this.trend_list=x?.data as any;
  })
}
getTrendChart(){
  this.api.get<any>(null,`reports/restaurant/`+this.report_type+'-trends/',{restaurant:this.restaurant,from:this.date_from,to:this.date_to,category:this.category,result:'graph'}).subscribe((x)=>{
    /* this.list=x?.data?.records as any[];  */ 
this.chart_data=x?.data as any;
  })
}
isObject(o:any){
return typeof(o)=='object'
}
getTransactionList(){
  this.api.get<any>(null,`reports/restaurant/`+this.report_type+'-listing/',{restaurant:this.restaurant,from:this.date_from,to:this.date_to}).subscribe((x)=>{
    /* this.list=x?.data?.records as any[];  */    
    if(x?.status==200){
this.transaction_list=x?.data as any;
    }
    if(x?.status==400){
      this.messageService.addMessage({severity:'error',summary:'Error',message:x?.message})
     }
    })
}
getTransactionSummary(){
  this.api.get<any>(null,`reports/restaurant/`+this.report_type+'-summary/',{restaurant:this.restaurant,from:this.date_from,to:this.date_to}).subscribe((x)=>{
    /* this.list=x?.data?.records as any[];  */    
    if(x?.status==200){
//this.transaction_summary=x?.data as any;
    }
    if(x?.status==400){
      this.messageService.addMessage({severity:'error',summary:'Error',message:x?.message})
     }
    })
}
removeUnderscore(x:string):string{
  return x.replace(/_/g," ");
}
reportData: any;
fromDate: string | null = null;
toDate: string | null = null;
selectedGrouping: string = 'items';
}
