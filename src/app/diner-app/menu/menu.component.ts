import { Component,OnInit } from '@angular/core';
import { MenuItem, Restaurant } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  styleUrls: ['./menu.component.css']
})
export class MenuComponent implements OnInit {
  restaurant?:Restaurant|any;
  menu_list?:MenuItem[]=[];
  constructor(private sessionStorage:SessionStorageService,private api:ApiService) {
  this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  console.log(this.restaurant)
  
  }
  ngOnInit(){
this.loadMenu()
  }
  loadMenu(){
    this.api.get<MenuItem>(null,'orders/journey/show-menu/',{restaurant:this.restaurant?.id}).subscribe((x)=>{
  this.menu_list=x.data as any;
      console.log(x?.data)
      
      
    })
  }
}
