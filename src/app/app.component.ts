import { Component, ViewChild, ViewContainerRef, AfterViewInit } from '@angular/core';
import { Router, NavigationEnd, NavigationStart, NavigationError, NavigationCancel } from '@angular/router';
import { MessageService } from './_services/message.service';
import { ConfirmDialogService } from './_common/confirm-dialog.service';
import { ConfirmDialogComponent } from './_common/confirm-dialog/confirm-dialog.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false
})
export class AppComponent implements AfterViewInit {
  title = 'dinify_frontend';
  @ViewChild("modalcontent", { read: ViewContainerRef }) contentRef!: ViewContainerRef;
  constructor(public messageService: MessageService,private dialog:ConfirmDialogService,private _diagRouter: Router){
    this._diagRouter.events.subscribe(e => {
      if (e instanceof NavigationStart || e instanceof NavigationEnd || e instanceof NavigationError || e instanceof NavigationCancel) {
        console.log('[DIAG] Router event:', e.constructor.name, (e as any).url ?? (e as any).reason ?? '');
      }
    });
  }

  ngAfterViewInit(){
    
      this.dialog.showModal?.subscribe(x=>{
      //  console.log(this.dialog?.data)
     // console.log("dialog service ",x)
      if(x){
       // console.log("dialog service ",x)
    
    const componentRef = this.contentRef.createComponent(ConfirmDialogComponent)
      componentRef.instance.data=this.dialog.data;
      this.contentRef.insert(componentRef.hostView);
    
      }else{
        this.contentRef?.clear();
      }
    }) 
  }

}
