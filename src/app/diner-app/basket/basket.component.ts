import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ConnectivityService } from '../../_services/connectivity.service';
import { SessionStorageService } from '../../_services/storage/session-storage.service';
import { TableScan } from '../../_models/app.models';
import { MenuNavStateService } from '../menu/menu-nav-state.service';

@Component({
    selector: 'app-basket',
    templateUrl: './basket.component.html',
    styleUrls: ['./basket.component.css'],
    standalone: false
})
export class BasketComponent implements OnInit, OnDestroy {
  // Table number for the header chip — from the table-scan payload the diner shell
  // captured to sessionStorage (the same 'Table' key the menu and basket-body read).
  tableNumber: number | null = null;

  constructor(
    public loc: Location,
    public connectivity: ConnectivityService,
    private sessionStorage: SessionStorageService,
    private navState: MenuNavStateService,
  ) {}

  ngOnInit(): void {
    this.tableNumber = this.sessionStorage.getItem<TableScan>('Table')?.number ?? null;

    // Hide the shared shell brand-strip on the basket PAGE only — the basket renders its
    // own one-bar header (back + "Your Basket" + Table chip). Cleared on destroy, so the
    // sibling order-complete route (a DIFFERENT component) still shows the strip. Mirrors
    // the menu's isMenuActive flag.
    this.navState.setBasketPageActive(true);

    // The basket page should always open scrolled to the top. The router does not reset
    // scroll on navigation (no scrollPositionRestoration configured), so without this the
    // basket inherits wherever the menu was scrolled. Mirrors MenuItemDetailComponent.
    window.scrollTo({ top: 0, left: 0 });
  }

  ngOnDestroy(): void {
    this.navState.setBasketPageActive(false);
  }
}
