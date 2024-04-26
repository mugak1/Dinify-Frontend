import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { ConfirmaDialogData } from '../_models/app.models';

@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {
showModal:BehaviorSubject<boolean>=new BehaviorSubject(false);
data:ConfirmaDialogData|null=null

  constructor() {this.showModal?.subscribe(x=>
    console.log(x)
  ) }
  openModal(d:ConfirmaDialogData){
    
    this.data=d;
this.showModal?.next(true);
  }

  OK(){
    
  }
  closeModal(){
    this.showModal?.next(false);
  }
}
