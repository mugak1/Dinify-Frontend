import { Component, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { Restaurant, TableScan } from '../_models/app.models';
import { environment } from 'src/environments/environment';
import { MenuNavStateService } from './menu/menu-nav-state.service';
import { BasketService } from '../_services/basket.service';
import { getContrastTextColor } from '../_common/utils/color-utils';

@Component({
    selector: 'app-diner-app',
    templateUrl: './diner-app.component.html',
    styleUrls: ['./diner-app.component.css'],
    standalone: false
})
export class DinerAppComponent {
  restaurant_name = '';
  restaurant_id = '';
  branding_configs: any;
  table!: TableScan;
  logo!: string;
  url = environment.apiUrl;
  table_id!: string;

  @ViewChild('brandStrip') brandStrip?: ElementRef<HTMLElement>;

  constructor(
    private readonly sessionStorage: SessionStorageService,
    private route: ActivatedRoute,
    private api: ApiService,
    public navState: MenuNavStateService,
    public basketService: BasketService,
  ) {
    if (this.route.children.length > 0) {
      this.route.children.at(0)?.params.subscribe(x => {
        if (x['table']) {
          this.table_id = x['table'];
          this.getTableDetails(x['table']);
        } else {
          this.hydrateFromSession();
        }
      });
    } else {
      this.hydrateFromSession();
    }
  }

  private hydrateFromSession(): void {
    const restaurant = this.sessionStorage.getItem<Restaurant>('restaurant') as any;
    this.table = this.sessionStorage.getItem<Restaurant>('Table') as any;
    this.table_id = this.table?.id;
    this.restaurant_name = restaurant?.name;
    this.restaurant_id = restaurant?.id;
    this.branding_configs = restaurant?.branding_configuration;
    this.logo = restaurant?.logo;
  }

  getTableDetails(id: any): void {
    this.api.get<TableScan>(null, 'orders/journey/table-scan/?table=' + id).subscribe(x => {
      this.table = x?.data as any;
      if (!this.table) return;
      this.sessionStorage.setItem('Table', this.table);
      this.sessionStorage.setItem('restaurant', this.table?.restaurant);
      this.logo = this.table?.restaurant?.logo;
      this.restaurant_name = this.table?.restaurant?.name;
      this.restaurant_id = this.table?.restaurant?.id;
      this.branding_configs = this.table?.restaurant?.branding_configuration as any;
    });
  }

  get brandStripBgColor(): string {
    return this.branding_configs?.home?.brand_color || '#ffffff';
  }

  get brandStripTextColor(): string {
    return getContrastTextColor(this.brandStripBgColor);
  }
}
