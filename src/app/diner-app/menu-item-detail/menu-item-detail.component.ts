import { Component } from '@angular/core';
import { ApiService } from 'src/app/_services/api.service';

@Component({
  selector: 'app-menu-item-detail',
  templateUrl: './menu-item-detail.component.html',
  styleUrls: ['./menu-item-detail.component.css']
})
export class MenuItemDetailComponent {

  /**
   *
   */
  constructor(private api:ApiService) {
   
    
  }
  getTableDetails(id:any){
    this.api.get<any>(null,'orders/journey/table-scan/?table='+id).subscribe(x=>{
    /* this.table=x.data as any;
    
    this.sessionStorage.setItem('restaurant',this.table.restaurant);
    this.restaurant_name=this.table.restaurant.name;
    this.restaurant_id=this.table.restaurant.id;
    this.branding_configs=this.table.restaurant.branding_configuration */
    })
    }
}
