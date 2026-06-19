import { Location } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ConnectivityService } from '../../_services/connectivity.service';
import { SessionStorageService } from '../../_services/storage/session-storage.service';
import { Restaurant, TableScan } from '../../_models/app.models';

@Component({
    selector: 'app-basket',
    templateUrl: './basket.component.html',
    styleUrls: ['./basket.component.css'],
    standalone: false
})
export class BasketComponent implements OnInit {
  // Header subtitle context — the restaurant the diner is ordering from and their
  // table number. Both come from the table-scan payload the diner shell captured to
  // sessionStorage (same 'restaurant'/'Table' keys the menu and basket-body read).
  restaurantName = '';
  tableNumber: number | null = null;

  constructor(
    public loc: Location,
    public connectivity: ConnectivityService,
    private sessionStorage: SessionStorageService,
  ) {}

  ngOnInit(): void {
    this.restaurantName = this.sessionStorage.getItem<Restaurant>('restaurant')?.name ?? '';
    this.tableNumber = this.sessionStorage.getItem<TableScan>('Table')?.number ?? null;

    // The basket page should always open scrolled to the top. The router does not
    // reset scroll on navigation (no scrollPositionRestoration configured), so without
    // this the basket inherits wherever the menu was scrolled. Mirrors
    // MenuItemDetailComponent.ngOnInit. Placed on the route component (not basket-body,
    // which is also rendered in the always-present desktop sidebar) so it only fires
    // on basket navigation.
    window.scrollTo({ top: 0, left: 0 });
  }
}
