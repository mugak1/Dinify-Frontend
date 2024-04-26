import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { BrandingConfiguration, Restaurant, TableScan } from '../_models/app.models';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-diner-app',
  templateUrl: './diner-app.component.html',
  styleUrls: ['./diner-app.component.css']
})
export class DinerAppComponent {
restaurant_name='Java House'
restaurant_id='523445-89ooo';
branding_configs!:BrandingConfiguration;
table!:TableScan


constructor(private readonly sessionStorage: SessionStorageService,private route:ActivatedRoute,private api:ApiService) {
  if(this.route.children.length>0){
   this.route.children.at(0)?.params.subscribe(x=>{
 if(x['id']){
   this.getTableDetails(x['id']);
 }
 
}) 
  }else{
    let restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
    this.restaurant_name=restaurant.name;
this.restaurant_id=restaurant.id;
this.branding_configs=restaurant.branding_configuration
  }

  
}

getTableDetails(id:any){
this.api.get<TableScan>(null,'orders/journey/table-scan/?table='+id).subscribe(x=>{
this.table=x.data as any;

this.sessionStorage.setItem('restaurant',this.table.restaurant);
this.restaurant_name=this.table.restaurant.name;
this.restaurant_id=this.table.restaurant.id;
this.branding_configs=this.table.restaurant.branding_configuration
})
}
}