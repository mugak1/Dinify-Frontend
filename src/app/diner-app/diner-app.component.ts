import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { BrandingConfiguration, Restaurant, TableScan } from '../_models/app.models';
import { AuthenticationService } from '../_services/authentication.service';
import { environment } from 'src/environments/environment';

@Component({
    selector: 'app-diner-app',
    templateUrl: './diner-app.component.html',
    styleUrls: ['./diner-app.component.css'],
    standalone: false
})
export class DinerAppComponent {
restaurant_name = '';
restaurant_id = '';
branding_configs!:BrandingConfiguration;
table!:TableScan
logo!: string;
url = environment.apiUrl;
table_id!:string;
button_action='';
  showProfileMenu: boolean=false;


constructor(private readonly sessionStorage: SessionStorageService,private route:ActivatedRoute,private api:ApiService,public auth:AuthenticationService) {
  /**/if(this.route.children.length>0){
   this.route.children.at(0)?.params.subscribe(x=>{
 if(x['table']){
  this.table_id=x['table']
   this.getTableDetails(x['table']);
 }else{

  const restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
  this.table=this.sessionStorage.getItem<Restaurant>('Table') as any;
  this.table_id=this.table?.id
  this.restaurant_name=restaurant?.name;
this.restaurant_id=restaurant?.id;
this.branding_configs=restaurant?.branding_configuration;
}

})
  } else{

    const restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
    this.table=this.sessionStorage.getItem<Restaurant>('Table') as any;
    this.table_id=this.table?.id
    this.restaurant_name=restaurant?.name;
this.restaurant_id=restaurant?.id;
this.branding_configs=restaurant?.branding_configuration;
  }


}

getTableDetails(id:any){
this.api.get<TableScan>(null,'orders/journey/table-scan/?table='+id).subscribe(x=>{
this.table=x?.data as any;
if(!this.table) return;
this.sessionStorage.setItem("Table",this.table);
this.sessionStorage.setItem('restaurant',this.table?.restaurant);
this.logo =this.table?.restaurant?.logo;
this.restaurant_name=this.table?.restaurant?.name;
this.restaurant_id=this.table?.restaurant?.id;
this.branding_configs=this.table?.restaurant?.branding_configuration as any;
})
}
closeModal(){
  this.showProfileMenu=false;
  this.button_action='';
}
logOut(){
  this.auth.logout(true);
}
}