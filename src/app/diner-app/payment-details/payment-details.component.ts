import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmDialogService } from 'src/app/_common/confirm-dialog.service';
import { ApiService } from 'src/app/_services/api.service';
import { MessageService } from 'src/app/_services/message.service';

@Component({
  selector: 'app-payment-details',
  templateUrl: './payment-details.component.html',
  styleUrl: './payment-details.component.css'
})
export class PaymentDetailsComponent {

  /**
   *
   */
  details:any;
  rating:any;
  comment:any;
  constructor(private api:ApiService, private route:ActivatedRoute, private dialog:ConfirmDialogService,private message:MessageService) {
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
  SendFeedBack(){
    let ref = this.dialog.openModal({
      title:'Review',
      message:'Are you sure you want to submit this review?',
      submitButtonText:'Submit'
    }).subscribe((x:any)=>{
     
      if(x?.action=='yes'){
    let obj={
    "order": this.details.order,
    "rating": this.rating,
    "review": this.comment
    }
this.api.postPatch('orders/review/',obj,'post').subscribe((x:any)=>{
if(x.status==200){
this.dialog.closeModal();
ref.unsubscribe();
this.rating='';
this.comment=''
this.message.add(x.message)
}else{
  this.dialog.closeModal();
 ref.unsubscribe();
 this.rating='';
this.comment=''
this.message.add(x.message)
}



},err=>{
alert(err.message)
this.dialog.closeModal();
ref.unsubscribe();
})
      }
    });
  }
}
