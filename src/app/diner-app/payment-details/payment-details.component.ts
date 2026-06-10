import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from 'src/app/_services/api.service';

@Component({
    selector: 'app-payment-details',
    templateUrl: './payment-details.component.html',
    styleUrl: './payment-details.component.css',
    standalone: false
})
export class PaymentDetailsComponent {

  /**
   *
   */
  details:any;
  constructor(private api:ApiService, private route:ActivatedRoute) {
    this.route.params.subscribe(x=>{
      if(x['id']){
        this.getPaymentDetails(x['id'])
      }
    })
  }
  getPaymentDetails(id:any){
    this.api.get<any>(null,'orders/journey/payment-details/?transaction='+id).subscribe(x=>{
this.details=x?.data
    })
  }
}
