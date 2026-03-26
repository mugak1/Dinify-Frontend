import { Component } from '@angular/core';
import { ApiService } from 'src/app/_services/api.service';
import { ActivatedRoute } from '@angular/router';
import { EmployeeListUser } from 'src/app/_models/app.models';
import { AuthenticationService } from 'src/app/_services/authentication.service';

@Component({
    selector: 'app-rest-users',
    templateUrl: './rest-users.component.html',
    styleUrl: './rest-users.component.css',
    standalone: false
})
export class RestUsersComponent {
  restaurant: any;
 users=[];
 usersCache=[];

  /**
   *
   */
  constructor(private auth:AuthenticationService, private api: ApiService, private route:ActivatedRoute) {
   
    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
      this.getUsers(this.restaurant);
    }else if(this.route.parent?.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.parent?.snapshot.params['id'];
      this.getUsers(this.restaurant);
    }
  }
  getUsers(id:any){
    this.api.get<EmployeeListUser[]>(null,'restaurant-setup/employees/?restaurant='+id).subscribe((x)=>{
      this.users=x.data?.records as any
      this.usersCache = x.data?.records as any;
    })
  }
}
