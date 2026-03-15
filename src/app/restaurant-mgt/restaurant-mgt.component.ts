import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { RestaurantDetail } from '../_models/app.models';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { environment } from 'src/environments/environment';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-restaurant-mgt',
  templateUrl: './restaurant-mgt.component.html',
  styleUrls: ['./restaurant-mgt.component.css']
})
export class RestaurantMgtComponent implements OnInit {
iscollapsed=false;
isChildComponent: boolean = false;
has_tables=false;
/**
 *
 */
baseUrl=environment.apiUrl;
constructor(public auth:AuthenticationService, private api:ApiService, private dialog:ConfirmDialogService, private route: ActivatedRoute, private router:Router,private cdr:ChangeDetectorRef) {
  // Check if the component is loaded through 
  const depth = this.route.pathFromRoot.length; // Count the 
  this.isChildComponent = (depth === 4);

if(this.auth.currentRestaurantRole){
  this.api.get<RestaurantDetail>(null,'restaurant-setup/'+'details/',{id:this.auth.currentRestaurantRole?.restaurant_id,record:'restaurants'}).subscribe((x)=>{
    this.auth.setCurrentRestaurant(x.data)
  })
}
this.router.events.subscribe((event) => {
this.router.url.includes('tables') ? this.has_tables=true : this.has_tables=false;
this.cdr.detectChanges();
});
}
ngOnInit(): void {
  this.updateShadows();
}
logout(){
  const ref = this.dialog.openModal({
    title:'Logout',
    message:'Are you sure you want to <strong>Log out</strong> ?',
  }).subscribe((x:any)=>{
    if(x?.action=='yes'){
    this.auth.logout();
    this.dialog.closeModal();
    ref.unsubscribe();
   
    
    
      //this.dialog.closeModal();
    }
    if(x?.action=='no'){
      this.dialog.closeModal();
      ref.unsubscribe();
    }
  })
  //this.auth.logout();
}
@HostListener('window:resize')
  onResize() {
    this.updateShadows();
  }

  onScroll(event: Event) {
    this.updateShadows();
  }

  private updateShadows() {
    const navbar = document.getElementById('scrollableNavbar');
    const topShadow = document.getElementById('top-shadow');
    const bottomShadow = document.getElementById('bottom-shadow');

    if (navbar) {
      const isAtTop = navbar.scrollTop === 0;
      const isAtBottom = navbar.scrollHeight - navbar.clientHeight === navbar.scrollTop;

      if (topShadow) {
        topShadow.style.opacity = isAtTop ? '0' : '1';
      }
      if (bottomShadow) {
        bottomShadow.style.opacity = isAtBottom ? '0' : '1';
      }
    }
  }
}
