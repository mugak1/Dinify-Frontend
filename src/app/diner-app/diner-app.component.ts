import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../_services/api.service';
import { SessionStorageService } from '../_services/storage/session-storage.service';
import { Restaurant, TableScan } from '../_models/app.models';
import { environment } from 'src/environments/environment';
import { MenuNavStateService } from './menu/menu-nav-state.service';
import { BasketService } from '../_services/basket.service';
import { DinerHeaderComponent } from './diner-header/diner-header.component';
import { getContrastTextColor } from '../_common/utils/color-utils';

@Component({
    selector: 'app-diner-app',
    templateUrl: './diner-app.component.html',
    styleUrls: ['./diner-app.component.css'],
    standalone: false
})
export class DinerAppComponent implements AfterViewInit, OnDestroy {
  restaurant_name = '';
  restaurant_id = '';
  branding_configs: any;
  table!: TableScan;
  logo!: string;
  coverPhoto: string | null = null;
  url = environment.apiUrl;
  table_id!: string;

  @ViewChild('dinerHeader') dinerHeader?: DinerHeaderComponent;
  @ViewChild('brandStrip') brandStrip?: ElementRef<HTMLElement>;

  private heroObserver?: IntersectionObserver;

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
    this.coverPhoto = restaurant?.cover_photo ?? null;
  }

  getTableDetails(id: any): void {
    this.api.get<TableScan>(null, 'orders/journey/table-scan/?table=' + id).subscribe(x => {
      this.table = x?.data as any;
      if (!this.table) return;
      this.sessionStorage.setItem('Table', this.table);
      this.sessionStorage.setItem('restaurant', this.table?.restaurant);
      this.logo = this.table?.restaurant?.logo;
      this.coverPhoto = this.table?.restaurant?.cover_photo ?? null;
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

  ngAfterViewInit(): void {
    this.tryAttachObserver();
  }

  private tryAttachObserver(attempt = 0): void {
    const heroEl = this.dinerHeader?.heroEl?.nativeElement;
    const stripEl = this.brandStrip?.nativeElement;
    if (!heroEl || !stripEl) {
      // Hero/strip rely on `*ngIf="table"` and async branding data, so the
      // refs may not be present on the first AfterViewInit tick. Retry a
      // handful of times before giving up.
      if (attempt < 20) {
        setTimeout(() => this.tryAttachObserver(attempt + 1), 100);
      }
      return;
    }

    this.heroObserver = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          stripEl.classList.remove('visible');
        } else {
          stripEl.classList.add('visible');
        }
      },
      { threshold: 0, rootMargin: '0px' },
    );
    this.heroObserver.observe(heroEl);
  }

  ngOnDestroy(): void {
    this.heroObserver?.disconnect();
  }
}
