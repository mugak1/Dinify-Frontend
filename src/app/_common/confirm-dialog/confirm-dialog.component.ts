import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { ConfirmaDialogData } from 'src/app/_models/app.models';
import { ConfirmDialogService } from '../confirm-dialog.service';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-confirm-dialog',
    templateUrl: './confirm-dialog.component.html',
    styleUrls: ['./confirm-dialog.component.css'],
    standalone: false
})
export class ConfirmDialogComponent implements AfterViewInit, OnDestroy {
  showModal=false;
  data:ConfirmaDialogData|null=null;
result!:string;
reason='';
has_reason?:boolean;
// True from the moment the user confirms until a consumer calls closeModal().
// Locks both footer buttons (and shows a spinner) so the confirm action cannot be
// re-tapped while the async work it triggered (e.g. placing an order) is in flight.
pending=false;
private modalSubscription!: Subscription;


  constructor(private confirmService:ConfirmDialogService) {
   this.confirmService.showModal?.subscribe(x=>{
      if(x){
        this.data=this.confirmService.data;
        this.has_reason=this.confirmService.data?.has_reason
        this.data?.callback?.next(this.result);
        this.openModal();
      }else{
        this.showModal=false;
      }
    })
    
    
  }
  Cancel(){
    this.confirmService.closeModal();
    this.confirmService.resultSub.next({action:'no',reason:this.reason});
  }
  toggleModal() {
    if (this.pending) { return; }
    this.pending = true;
    this.result='yes';
    this.confirmService.resultSub.next({action:'yes',reason:this.reason});
/* this.data?.callback?.next(this.result);

this.data?.callback?.subscribe(x=>{
  console.log(x) 
})*/
   // this.confirmService.closeModal()
}
ngAfterViewInit(){
this.confirmService.DialogRef=this;
}
// eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
ngOnDestroy() {
  // intentionally empty - subscription cleanup handled elsewhere
}

Reject(){
  this.result='reject';
    this.confirmService.resultSub.next({action:'reject',reason:this.reason});
}
openModal() {
  this.showModal = true;
  this.pending = false;
  setTimeout(() => {
    document.getElementById('confirm-modal-content')?.focus();
  }, 100);
}

handleKeyDown(event: KeyboardEvent) {
  // Scope the Tab-cycle to the actual modal root. The previous '#modal-container'
  // selector matched no element (there is none), so the trap was a silent no-op.
  const focusableElements = document.querySelectorAll(
    '#confirm-modal-content button:not([disabled]), #confirm-modal-content textarea, #confirm-modal-content input'
  );

  const firstElement = focusableElements[0] as HTMLElement;
  const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

  if (event.key === 'Tab') {
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

}

}
