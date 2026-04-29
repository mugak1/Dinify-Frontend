import { Component, ViewChild, ViewContainerRef, AfterViewInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { MessageService } from './_services/message.service';
import { ConfirmDialogService } from './_common/confirm-dialog.service';
import { ConfirmDialogComponent } from './_common/confirm-dialog/confirm-dialog.component';
import { AuthenticationService } from './_services/authentication.service';
import { InactivityService } from './_services/inactivity.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false
})
export class AppComponent implements AfterViewInit, OnDestroy {
  title = 'dinify_frontend';
  @ViewChild("modalcontent", { read: ViewContainerRef }) contentRef!: ViewContainerRef;
  private userSub?: Subscription;
  constructor(
    public messageService: MessageService,
    private dialog: ConfirmDialogService,
    private auth: AuthenticationService,
    private inactivity: InactivityService,
  ){

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

    // Wire inactivity timeout to authentication state. Subscribed here (not ngOnInit)
    // so the ConfirmDialogService host is fully initialised before any warning dialog
    // can open. Idempotent start/stop guards inside InactivityService handle re-emits.
    this.userSub = this.auth.user.subscribe(user => {
      if (user) {
        this.inactivity.start();
      } else {
        this.inactivity.stop();
      }
    });
  }

  ngOnDestroy(){
    this.userSub?.unsubscribe();
    this.inactivity.stop();
  }

}
