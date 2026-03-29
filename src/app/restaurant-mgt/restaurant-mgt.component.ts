import { ChangeDetectorRef, Component } from '@angular/core';
import { AuthenticationService } from '../_services/authentication.service';
import { ApiService } from '../_services/api.service';
import { RestaurantDetail } from '../_models/app.models';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { environment } from 'src/environments/environment';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
    selector: 'app-restaurant-mgt',
    templateUrl: './restaurant-mgt.component.html',
    styleUrls: ['./restaurant-mgt.component.css'],
    standalone: false
})
export class RestaurantMgtComponent {
  sidebarOpen = true;
  isChildComponent = false;
  has_tables = false;
  baseUrl = environment.apiUrl;

  constructor(
    public auth: AuthenticationService,
    private api: ApiService,
    private dialog: ConfirmDialogService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    const depth = this.route.pathFromRoot.length;
    this.isChildComponent = depth === 4;

    if (this.auth.currentRestaurantRole) {
      this.api
        .get<RestaurantDetail>(null, 'restaurant-setup/' + 'details/', {
          id: this.auth.currentRestaurantRole?.restaurant_id,
          record: 'restaurants',
        })
        .subscribe((x) => {
          this.auth.setCurrentRestaurant(x.data);
        });
    }

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.has_tables = this.router.url.includes('tables');
        this.cdr.detectChanges();
      });
  }

  logout(): void {
    const ref = this.dialog
      .openModal({
        title: 'Logout',
        message: 'Are you sure you want to <strong>Log out</strong> ?',
      })
      .subscribe((x: any) => {
        if (x?.action === 'yes') {
          this.auth.logout();
          this.dialog.closeModal();
          ref.unsubscribe();
        }
        if (x?.action === 'no') {
          this.dialog.closeModal();
          ref.unsubscribe();
        }
      });
  }
}
