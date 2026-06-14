import { Location } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ConnectivityService } from '../../_services/connectivity.service';

@Component({
    selector: 'app-basket',
    templateUrl: './basket.component.html',
    styleUrls: ['./basket.component.css'],
    standalone: false
})
export class BasketComponent implements OnInit {
  constructor(public loc: Location, public connectivity: ConnectivityService) {}

  ngOnInit(): void {
    // The basket page should always open scrolled to the top. The router does not
    // reset scroll on navigation (no scrollPositionRestoration configured), so without
    // this the basket inherits wherever the menu was scrolled. Mirrors
    // MenuItemDetailComponent.ngOnInit. Placed on the route component (not basket-body,
    // which is also rendered in the always-present desktop sidebar) so it only fires
    // on basket navigation.
    window.scrollTo({ top: 0, left: 0 });
  }
}
