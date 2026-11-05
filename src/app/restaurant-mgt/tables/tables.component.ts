import { ChangeDetectionStrategy, Component, Inject, Optional } from '@angular/core';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { PersistedValue } from '../../_services/storage/persisted-state';
import { TablesSetupViewComponent } from './components/tables-setup-view/tables-setup-view.component';
import { TablesServiceViewComponent } from './components/tables-service-view/tables-service-view.component';
import { PageHeaderComponent } from '../../_shared/ui/page-header/page-header.component';
import { DnSegItem, DnSegmentedComponent } from '../../_shared/ui/segmented/segmented.component';
import { FloorService } from './services/floor.service';
import { FLOOR_DEV_MODE, floorViewAvailable } from './services/floor-view-gate';

type TablesView = 'service' | 'setup';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-tables',
  standalone: true,
  imports: [TablesSetupViewComponent, TablesServiceViewComponent, PageHeaderComponent, DnSegmentedComponent],
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.css'],
})
export class TablesComponent {
  /**
   * Whether the floor view (the Service view, Step 2) may be shown at all.
   *
   * THE PRODUCTION GATE. Since FE-C the floor reads the real endpoints and
   * `FloorService.USE_MOCK_DATA` is off, so this is true in every build and the floor
   * is live. The gate stays because the guarantee it carries still matters: were the
   * mock flag ever left on, the floor would run on sample tables and sample orders, and
   * a live restaurant must never see those — so the view, its toggle and a persisted
   * 'service' selection would exist only in a development build again
   * (`floor-view-gate.ts` says why that is `isDevMode()`, not `environment.production`).
   * Pinned by `tables.component.spec.ts`.
   */
  readonly floorViewAvailable: boolean;

  readonly viewItems: DnSegItem[] = [
    { value: 'service', label: 'Floor' },
    { value: 'setup', label: 'Setup' },
  ];

  private readonly _activeView!: PersistedValue<TablesView>;

  get activeView(): TablesView {
    // Belt and braces: even a value that slipped past `validate` cannot open the floor.
    return this.floorViewAvailable ? this._activeView.value : 'setup';
  }

  constructor(
    private auth: AuthenticationService,
    private localStorage: LocalStorageService,
    // Optional so the unit specs can construct the component directly; absent means a
    // production build, which is the safe answer.
    @Optional() @Inject(FLOOR_DEV_MODE) devMode: boolean | null = null,
  ) {
    this.floorViewAvailable = floorViewAvailable(devMode === true, FloorService.USE_MOCK_DATA);
    this._activeView = new PersistedValue<TablesView>('setup', {
      storage: this.localStorage,
      getKey: () => `tables.activeView:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is TablesView => v === 'setup' || (v === 'service' && this.floorViewAvailable),
    });
  }

  setView(view: string): void {
    if (view === 'setup' || (view === 'service' && this.floorViewAvailable)) {
      this._activeView.value = view;
    }
  }
}
