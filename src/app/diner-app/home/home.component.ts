import { AfterViewInit, Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BrandingConfiguration, Restaurant, TableScan } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { environment } from 'src/environments/environment';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.css'],
    standalone: false
})
export class HomeComponent implements AfterViewInit {
  branding_configs!:BrandingConfiguration;
  restaurant?:Restaurant;
  url=environment.apiUrl;
  table!:TableScan
  logo: string='';
  restaurant_name: string='';
  restaurant_id: string='';
  constructor(private sessionStorage:SessionStorageService,private route:ActivatedRoute,private api:ApiService) {
    this.route.params.subscribe(x=>{
      if(x['table']){
        this.getTableDetails(x['table']);
      }else{
        this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
        this.table=this.sessionStorage.getItem<TableScan>('Table') as any;
        this.branding_configs=this.restaurant?.branding_configuration as any;
      }
    })

    
  }
  getTableDetails(id:any){
  this.api.get<TableScan>(null,'orders/journey/table-scan/?table='+id).subscribe(x=>{
  this.table=x?.data as any;
  if(!this.table) return;
  this.sessionStorage.setItem("Table",this.table);
  this.sessionStorage.setItem('restaurant',this.table?.restaurant);
  this.restaurant=this.table?.restaurant as any;
  this.logo =this.table?.restaurant?.logo;
  this.restaurant_name=this.table?.restaurant?.name;
  this.restaurant_id=this.table?.restaurant?.id;
  this.branding_configs=this.table?.restaurant?.branding_configuration as any;
  })
  }
  ngAfterViewInit(){
    this.sessionStorage.StorageValue.subscribe(_x=>{
    this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
    this.table=this.sessionStorage.getItem<TableScan>('Table') as any;
    this.branding_configs=this.restaurant?.branding_configuration as any;
    })

  }
  
getOrder(_id:any){
  
}
  
}
