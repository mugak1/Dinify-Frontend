import { Component } from '@angular/core';
import { ConfirmaDialogData } from 'src/app/_models/app.models';
import { ConfirmDialogService } from '../confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.css']
})
export class ConfirmDialogComponent {
  showModal=false;
  data:ConfirmaDialogData|null=null


  constructor(private confirmService:ConfirmDialogService) {
    this.confirmService.showModal?.subscribe(x=>{
      if(x){
        this.data=this.confirmService.data;
        this.showModal=true;
      }else{
        this.showModal=false;
      }
    })
    
  }
  toggleModal() {

    this.confirmService.closeModal()
}

}
