import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { PersistedValue } from '../../_services/storage/persisted-state';
import { TablesServiceViewComponent } from './components/tables-service-view/tables-service-view.component';
import { TablesSetupViewComponent } from './components/tables-setup-view/tables-setup-view.component';

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [CommonModule, TablesServiceViewComponent, TablesSetupViewComponent],
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.css'],
})
export class TablesComponent {
  private readonly _activeView!: PersistedValue<'service' | 'setup'>;

  get activeView(): 'service' | 'setup' {
    return this._activeView.value;
  }
  set activeView(value: 'service' | 'setup') {
    this._activeView.value = value;
  }

  constructor(
    private auth: AuthenticationService,
    private localStorage: LocalStorageService,
  ) {
    this._activeView = new PersistedValue<'service' | 'setup'>('service', {
      storage: this.localStorage,
      getKey: () => `tables.activeView:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is 'service' | 'setup' => v === 'service' || v === 'setup',
    });
  }
}
