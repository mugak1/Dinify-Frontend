import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BrandingConfiguration, Restaurant } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { SessionStorageService } from 'src/app/_services/storage/session-storage.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent {
  branding_configs!:BrandingConfiguration;
  restaurant?:Restaurant;
  url=environment.apiUrl
  constructor(private sessionStorage:SessionStorageService) {
  this.restaurant=this.sessionStorage.getItem<Restaurant>('restaurant') as any;
    this.branding_configs=this.restaurant?.branding_configuration as any;
  }
  

  
}
