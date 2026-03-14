import { Injectable, TemplateRef } from '@angular/core';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ConfirmaDialogData } from '../_models/app.models';
import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {
showModal:BehaviorSubject<boolean>=new BehaviorSubject(false);
data:ConfirmaDialogData|null=null
DialogRef!:ConfirmDialogComponent;
result!:string;
resultSub= new BehaviorSubject({});
  constructor() {
  
    this.showModal?.subscribe(x=>
    {}
  )
 
}
  openModal(d:ConfirmaDialogData){
    
    this.data=d;
   // this.data.callback=this.resultSub;
this.showModal?.next(true);
//console.log(this.data.callback)
return this.resultSub
  }

 
  closeModal(){
    this.showModal?.next(false);
    this.resultSub.next({});
  }
}
