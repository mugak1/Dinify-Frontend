import { Component, OnInit } from '@angular/core';
import { ApiResponse, NotificationItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

@Component({
    selector: 'app-common-notifications',
    templateUrl: './common-notifications.component.html',
    styleUrl: './common-notifications.component.css',
    standalone: false
})
export class CommonNotificationsComponent implements OnInit {
  notifys:NotificationItem[] = [];
  collapses:any[] = [];
  isLoading = false;
  configSub = {
      id: "notifications",
      itemsPerPage: 20,
      currentPage: 1
  }
  prevSelected = 0
  constructor(private api:ApiService) {
    
}
ngOnInit() {
    this.loadList()
}
loadList(skip_read?:boolean,_skip_archived?:boolean) {
    this.api.get<NotificationItem>(null, `notifications/?${skip_read?'skip_read='+skip_read:''}&skip_archived=True`).subscribe((e:ApiResponse<any>)=>{
        this.notifys = (<any> e.data);
    }
    )
}
collapseNot(i:any, n:NotificationItem) {
  if(!n.read){
  this.api.postPatch("notifications/", {
    notification_id: n._id
    }, "put").subscribe(_r=>{
        this.loadList()
    }
    ) 
  }

    if(this.collapses[i]){
      this.collapses[i]=!this.collapses[i]
    }else{
      this.collapses[i]=true
    }
    if(this.prevSelected){
      if(this.prevSelected!=i){
        this.collapses[this.prevSelected]=false;
      }
    }else{
      if(this.prevSelected!=i){
        this.collapses[this.prevSelected]=false;
      }
    }
    this.prevSelected=i;
}
collapsePrev() {
    this.collapses[this.prevSelected] = !1
}
}
