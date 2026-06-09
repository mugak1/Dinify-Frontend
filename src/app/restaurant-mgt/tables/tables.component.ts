import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { PersistedValue } from '../../_services/storage/persisted-state';
import { TablesSetupViewComponent } from './components/tables-setup-view/tables-setup-view.component';

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [CommonModule, TablesSetupViewComponent],
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.css'],
})
export class TablesComponent {
  // MVP: only the Setup View ships. The Service View is parked — its component,
  // services, mocks and models stay in the repo, simply unrendered. The view-state
  // is forced to 'setup': the seed is 'setup' and validate honours only 'setup',
  // so a previously-persisted 'service' selection is read back, rejected, and
  // falls through to the default. The 'service' member is kept on the union so
  // re-enabling the toggle later is a small revert.
  private readonly _activeView!: PersistedValue<'service' | 'setup'>;

  get activeView(): 'service' | 'setup' {
    return this._activeView.value;
  }

  constructor(
    private auth: AuthenticationService,
    private localStorage: LocalStorageService,
  ) {
    this._activeView = new PersistedValue<'service' | 'setup'>('setup', {
      storage: this.localStorage,
      getKey: () => `tables.activeView:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is 'service' | 'setup' => v === 'setup',
    });
  }
}
