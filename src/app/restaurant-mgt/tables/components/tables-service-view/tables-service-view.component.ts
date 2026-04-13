import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { TablesService } from '../../services/tables.service';
import { ServiceToolbarComponent, ServiceMetrics } from '../service-toolbar/service-toolbar.component';
import { FloorPlanCanvasComponent } from '../floor-plan-canvas/floor-plan-canvas.component';
import { ReservationsPaneComponent } from '../reservations-pane/reservations-pane.component';
import { NewReservationModalComponent } from '../new-reservation-modal/new-reservation-modal.component';
import { TableDetailsDrawerComponent } from '../table-details-drawer/table-details-drawer.component';
import { TransferTableModalComponent } from '../transfer-table-modal/transfer-table-modal.component';
import {
  TableFilters,
  DiningArea,
  RestaurantTable,
  Server,
  Reservation,
  WaitlistEntry,
  SeatedParty,
} from '../../models/tables.models';
import { mockSeatedParties } from '../../data/tables-mock-data';

@Component({
  selector: 'app-tables-service-view',
  standalone: true,
  imports: [
    CommonModule,
    ServiceToolbarComponent,
    FloorPlanCanvasComponent,
    ReservationsPaneComponent,
    NewReservationModalComponent,
    TableDetailsDrawerComponent,
    TransferTableModalComponent,
  ],
  templateUrl: './tables-service-view.component.html',
})
export class TablesServiceViewComponent implements OnInit, OnDestroy {
  areas: DiningArea[] = [];
  tables: RestaurantTable[] = [];
  servers: Server[] = [];
  reservations: Reservation[] = [];
  waitlist: WaitlistEntry[] = [];
  seatedParties: SeatedParty[] = [];

  filters: TableFilters = {
    area: 'all',
    status: [],
    servers: [],
    tableSize: [],
    search: '',
  };

  selectedTableId: string | null = null;
  selectedTableIds: string[] = [];
  isNewReservationModalOpen = false;
  transferSourceTableId: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private tablesService: TablesService,
    private toast: ToastService,
    private auth: AuthenticationService,
  ) {}

  private get restaurantId(): string {
    return this.auth.currentRestaurantRole?.restaurant_id ?? '';
  }

  ngOnInit(): void {
    combineLatest([
      this.tablesService.areas$,
      this.tablesService.tables$,
      this.tablesService.reservations$,
      this.tablesService.waitlist$,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([areas, tables, reservations, waitlist]) => {
        this.areas = areas;
        this.tables = tables;
        this.reservations = reservations;
        this.waitlist = waitlist;
        this.seatedParties = this.tablesService.getSeatedParties();
      });

    // Load initial data
    this.tablesService.getAreas('').subscribe();
    this.tablesService.getTables('').subscribe();
    this.tablesService.getReservations('').subscribe();
    this.tablesService.getWaitlist('').subscribe();
    this.tablesService.getServers('').subscribe(s => (this.servers = s));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Filtered tables ───────────────────────────────────

  get filteredTables(): RestaurantTable[] {
    return this.tables.filter(t => {
      // Area
      if (this.filters.area !== 'all' && t.areaId !== this.filters.area) return false;
      // Status
      if (this.filters.status.length > 0 && !this.filters.status.includes(t.status)) return false;
      // Server
      if (this.filters.servers.length > 0) {
        if (this.filters.servers.includes('unassigned')) {
          if (t.serverId && !this.filters.servers.includes(t.serverId)) return false;
        } else {
          if (!t.serverId || !this.filters.servers.includes(t.serverId)) return false;
        }
      }
      // Size
      if (this.filters.tableSize.length > 0) {
        const match = this.filters.tableSize.some(size =>
          size === 6 ? t.maxCapacity >= 6 : t.maxCapacity === size,
        );
        if (!match) return false;
      }
      // Search
      if (this.filters.search) {
        const q = this.filters.search.toLowerCase();
        const party = this.seatedParties.find(p => p.tableId === t.id);
        const nameMatch = party?.guest?.name?.toLowerCase().includes(q) ?? false;
        const numMatch = String(t.number).includes(q);
        const dispMatch = t.displayName?.toLowerCase().includes(q) ?? false;
        if (!numMatch && !dispMatch && !nameMatch) return false;
      }
      return true;
    });
  }

  // ── Metrics ───────────────────────────────────────────

  get metrics(): ServiceMetrics {
    const seated = this.tables.filter(t => t.status === 'seated').length;
    const total = this.tables.filter(t => t.status !== 'out_of_service').length;
    const guestsSeated = this.seatedParties.reduce((sum, p) => sum + p.partySize, 0);
    const avgTime =
      this.seatedParties.length > 0
        ? Math.round(
            this.seatedParties.reduce(
              (sum, p) => sum + (Date.now() - p.seatedAt.getTime()) / 60000,
              0,
            ) / this.seatedParties.length,
          )
        : 0;
    return { inUse: seated, total, guestsSeated, avgTableTime: avgTime };
  }

  // ── Filter change ─────────────────────────────────────

  onFiltersChange(filters: TableFilters): void {
    this.filters = filters;
  }

  // ── Table selection ───────────────────────────────────

  onTableSelect(event: { tableId: string; isMultiSelect: boolean }): void {
    if (event.isMultiSelect) {
      if (this.selectedTableIds.includes(event.tableId)) {
        this.selectedTableIds = this.selectedTableIds.filter(id => id !== event.tableId);
      } else {
        this.selectedTableIds = [...this.selectedTableIds, event.tableId];
      }
    } else {
      this.selectedTableId = this.selectedTableId === event.tableId ? null : event.tableId;
      this.selectedTableIds = [];
    }
  }

  // ── Seat reservation on drop ──────────────────────────

  onSeatReservation(event: { reservationId: string; tableId: string }): void {
    const reservation = this.reservations.find(r => r.id === event.reservationId);
    const table = this.tables.find(t => t.id === event.tableId);
    if (!reservation || !table) return;

    this.tablesService.updateTableStatus(event.tableId, 'seated').subscribe();
    this.tablesService.updateReservation({
      id: event.reservationId,
      status: 'seated',
      tableId: event.tableId,
      seatedAt: new Date(),
    });

    // Create seated party
    const newParty: SeatedParty = {
      id: `seated-${Date.now()}`,
      tableId: event.tableId,
      guest: reservation.guest,
      partySize: reservation.partySize,
      adults: reservation.partySize,
      children: 0,
      seatedAt: new Date(),
      serverId: table.serverId ?? 'srv-1',
      reservationId: reservation.id,
      currentCheck: 0,
      isPaid: false,
      orderItems: [],
    };
    mockSeatedParties.push(newParty);
    this.seatedParties = [...mockSeatedParties];
  }

  // ── Tables change (from floor plan save) ──────────────

  onTablesChange(updatedTables: RestaurantTable[]): void {
    const positions = updatedTables.map(t => ({ id: t.id, x: t.x, y: t.y }));
    this.tablesService.updateFloorPlan(positions);

    // Handle new tables
    for (const t of updatedTables) {
      if (t.id.startsWith('t-new-')) {
        this.tablesService.createTable(t, this.restaurantId).subscribe();
      }
    }
  }

  // ── Reservation handlers ──────────────────────────────

  onNewReservation(): void {
    this.isNewReservationModalOpen = true;
  }

  onNewReservationSaved(data: Omit<Reservation, 'id' | 'status'>): void {
    this.tablesService.createReservation({ ...data, status: 'confirmed' } as any);
    this.isNewReservationModalOpen = false;
    this.toast.success('Reservation created');
  }

  onEditReservation(res: Reservation): void {
    this.tablesService.updateReservation(res);
  }

  onCancelReservation(resId: string): void {
    this.tablesService.cancelReservation(resId);
  }

  onMarkNoShow(resId: string): void {
    const res = this.reservations.find(r => r.id === resId);
    if (res?.tableId) {
      this.tablesService.updateTableStatus(res.tableId, 'available').subscribe();
    }
    this.tablesService.markNoShow(resId);
  }

  onSeatFromWaitlist(event: { waitlistId: string; tableId: string }): void {
    this.tablesService.seatFromWaitlist(event.waitlistId, event.tableId);
  }

  onViewTable(tableId: string): void {
    this.selectedTableId = tableId;
    this.selectedTableIds = [];
  }

  // ── Drawer state ──────────────────────────────────────

  get isDrawerOpen(): boolean {
    return this.selectedTableId !== null || this.selectedTableIds.length > 0;
  }

  onCloseDrawer(): void {
    this.selectedTableId = null;
    this.selectedTableIds = [];
  }

  // ── Drawer handlers ───────────────────────────────────

  onMarkStatus(event: { tableId: string; status: 'dirty' | 'available' | 'out_of_service' }): void {
    this.tablesService.updateTableStatus(event.tableId, event.status).subscribe();
  }

  onSeatWalkIn(event: { tableId: string; partySize: number }): void {
    this.tablesService.seatWalkIn(event.tableId, event.partySize);
    this.seatedParties = this.tablesService.getSeatedParties();
  }

  onMarkPaid(tableId: string): void {
    this.tablesService.updateTableStatus(tableId, 'available').subscribe();
    // Remove seated party from mock data
    const idx = mockSeatedParties.findIndex(p => p.tableId === tableId);
    if (idx >= 0) {
      mockSeatedParties.splice(idx, 1);
      this.seatedParties = [...mockSeatedParties];
    }
  }

  onOffSystemPay(event: { tableId: string; method: string; reference?: string }): void {
    this.tablesService.updateTableStatus(event.tableId, 'available').subscribe();
    const idx = mockSeatedParties.findIndex(p => p.tableId === event.tableId);
    if (idx >= 0) {
      mockSeatedParties.splice(idx, 1);
      this.seatedParties = [...mockSeatedParties];
    }
  }

  onDrawerAddToWaitlist(entry: { guestName: string; partySize: number; phone?: string; notes?: string }): void {
    this.tablesService.addToWaitlist({
      guest: { name: entry.guestName, phone: entry.phone },
      partySize: entry.partySize,
    });
  }

  onChangeServer(event: { tableId: string; serverId: string }): void {
    this.tablesService.updateTable({ id: event.tableId, serverId: event.serverId }).subscribe();
    // Also update the seated party
    const party = mockSeatedParties.find(p => p.tableId === event.tableId);
    if (party) party.serverId = event.serverId;
    this.seatedParties = [...mockSeatedParties];
  }

  onAddNote(_event: { tableId: string; note: string }): void {
    // Notes are not persisted in mock mode; toast feedback is shown by the drawer.
  }

  onMergeTables(tableIds: string[]): void {
    // Mark secondary tables as dirty, keep primary
    const sorted = tableIds
      .map(id => this.tables.find(t => t.id === id)!)
      .filter(Boolean)
      .sort((a, b) => a.number - b.number);
    if (sorted.length < 2) return;
    for (let i = 1; i < sorted.length; i++) {
      this.tablesService.updateTableStatus(sorted[i].id, 'dirty').subscribe();
    }
    this.selectedTableIds = [];
    this.selectedTableId = sorted[0].id;
  }

  onTransfer(tableId: string): void {
    this.transferSourceTableId = tableId;
  }

  onTransferComplete(evt: { sourceTableId: string; destinationTableId: string }): void {
    this.tablesService.transferTable(evt.sourceTableId, evt.destinationTableId);
    const dest = this.tables.find(t => t.id === evt.destinationTableId);
    const destName = dest?.displayName || (dest ? `Table ${dest.number}` : 'table');
    this.toast.success(`Party transferred to ${destName}`);
    this.transferSourceTableId = null;
    this.selectedTableId = evt.destinationTableId;
    this.selectedTableIds = [];
    this.seatedParties = this.tablesService.getSeatedParties();
  }

  onTransferClose(): void {
    this.transferSourceTableId = null;
  }

  get transferSourceTable(): RestaurantTable | null {
    return this.transferSourceTableId
      ? this.tables.find(t => t.id === this.transferSourceTableId) ?? null
      : null;
  }

  get transferSourceParty(): SeatedParty | null {
    return this.transferSourceTableId
      ? this.seatedParties.find(p => p.tableId === this.transferSourceTableId) ?? null
      : null;
  }
}
