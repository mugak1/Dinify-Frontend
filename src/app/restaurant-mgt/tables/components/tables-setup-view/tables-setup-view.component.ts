import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, combineLatest } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { SwitchComponent } from '../../../../_shared/ui/switch/switch.component';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { TooltipDirective } from '../../../../_shared/ui/tooltip/tooltip.directive';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { TablesService } from '../../services/tables.service';
import { NewAreaModalComponent } from '../new-area-modal/new-area-modal.component';
import { NewTableModalComponent } from '../new-table-modal/new-table-modal.component';
import { QrCodePreviewModalComponent } from '../qr-code-preview-modal/qr-code-preview-modal.component';
import {
  DiningArea,
  RestaurantTable,
  SeatedParty,
} from '../../models/tables.models';
import { generateQRPrintSheet, getTableQRUrl } from '../../utils/qr-print-sheet';
import QRCode from 'qrcode';

@Component({
  selector: 'app-tables-setup-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ButtonComponent,
    BadgeComponent,
    SwitchComponent,
    DialogComponent,
    TooltipDirective,
    NewAreaModalComponent,
    NewTableModalComponent,
    QrCodePreviewModalComponent,
  ],
  templateUrl: './tables-setup-view.component.html',
})
export class TablesSetupViewComponent implements OnInit, OnDestroy {
  areas: DiningArea[] = [];
  tables: RestaurantTable[] = [];
  seatedParties: SeatedParty[] = [];

  // Filters
  search = '';
  areaFilter = 'all';
  statusFilter = 'all';
  qrFilter = 'all';

  // Selection
  selectedTableIds: string[] = [];

  // Expand/collapse
  expandedAreas: string[] = [];

  // Area modal
  isAreaModalOpen = false;
  editingArea: DiningArea | null = null;

  // Table modal
  isTableModalOpen = false;
  editingTable: RestaurantTable | null = null;
  newTableAreaId: string | undefined;

  // Delete confirmations
  deleteTableTarget: RestaurantTable | null = null;
  deleteAreaTarget: DiningArea | null = null;

  // Move dialog
  isMoveDialogOpen = false;
  moveTargetAreaId = '';
  moveSelectedTableIds: string[] = [];

  // Bulk actions dropdown
  showBulkMenu = false;

  // QR preview
  qrPreviewTable: RestaurantTable | null = null;
  isQrModalOpen = false;

  // Regenerate confirmations
  regenTableTarget: RestaurantTable | null = null;
  regenAreaTarget: DiningArea | null = null;
  isRegenAllOpen = false;

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
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([areas, tables]) => {
        this.areas = areas;
        this.tables = tables;
        // Expand all areas on first load
        if (this.expandedAreas.length === 0 && areas.length > 0) {
          this.expandedAreas = areas.map(a => a.id);
        }
      });

    this.seatedParties = this.tablesService.getSeatedParties();

    // Load initial data — areas first so getTables() can build its
    // tableId → areaId lookup from the current areas$ state.
    this.refresh();
  }

  private refresh(): void {
    this.tablesService.getAreas(this.restaurantId).pipe(
      switchMap(() => this.tablesService.getTables(this.restaurantId)),
    ).subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Filtering ─────────────────────────────────────────

  get filteredTables(): RestaurantTable[] {
    return this.tables.filter(t => {
      // Search
      if (this.search) {
        const q = this.search.toLowerCase();
        const area = this.areas.find(a => a.id === t.areaId);
        const match =
          String(t.number).includes(q) ||
          (t.displayName?.toLowerCase().includes(q) ?? false) ||
          (area?.name.toLowerCase().includes(q) ?? false);
        if (!match) return false;
      }
      // Area filter
      if (this.areaFilter !== 'all' && t.areaId !== this.areaFilter) return false;
      // Status filter
      if (this.statusFilter === 'available' && !t.isActive) return false;
      if (this.statusFilter === 'not_available' && t.isActive) return false;
      if (this.statusFilter === 'out_of_service' && t.status !== 'out_of_service') return false;
      // QR filter
      if (this.qrFilter === 'has_qr' && !t.hasQR) return false;
      if (this.qrFilter === 'no_qr' && t.hasQR) return false;

      return true;
    });
  }

  getTablesForArea(areaId: string): RestaurantTable[] {
    return this.filteredTables.filter(t => t.areaId === areaId);
  }

  getUnassignedTables(): RestaurantTable[] {
    return this.filteredTables.filter(t => !t.areaId);
  }

  getTotalSeats(tables: RestaurantTable[]): number {
    return tables.reduce((sum, t) => sum + t.maxCapacity, 0);
  }

  // ── Expand/collapse ───────────────────────────────────

  isExpanded(areaId: string): boolean {
    return this.expandedAreas.includes(areaId);
  }

  toggleAreaExpanded(areaId: string): void {
    if (this.expandedAreas.includes(areaId)) {
      this.expandedAreas = this.expandedAreas.filter(id => id !== areaId);
    } else {
      this.expandedAreas = [...this.expandedAreas, areaId];
    }
  }

  // ── Selection ─────────────────────────────────────────

  toggleTableSelection(tableId: string): void {
    if (this.selectedTableIds.includes(tableId)) {
      this.selectedTableIds = this.selectedTableIds.filter(id => id !== tableId);
    } else {
      this.selectedTableIds = [...this.selectedTableIds, tableId];
    }
  }

  isTableSelected(tableId: string): boolean {
    return this.selectedTableIds.includes(tableId);
  }

  areAllAreaTablesSelected(areaId: string): boolean {
    const areaTables = this.getTablesForArea(areaId);
    return areaTables.length > 0 && areaTables.every(t => this.selectedTableIds.includes(t.id));
  }

  toggleAreaSelection(areaId: string): void {
    const areaTables = this.getTablesForArea(areaId);
    if (this.areAllAreaTablesSelected(areaId)) {
      this.selectedTableIds = this.selectedTableIds.filter(
        id => !areaTables.find(t => t.id === id),
      );
    } else {
      const newIds = areaTables.map(t => t.id);
      this.selectedTableIds = [...new Set([...this.selectedTableIds, ...newIds])];
    }
  }

  // ── Active orders check ───────────────────────────────

  hasActiveOrder(tableId: string): boolean {
    return this.seatedParties.some(p => p.tableId === tableId);
  }

  // ── Area CRUD ─────────────────────────────────────────

  openNewArea(): void {
    this.editingArea = null;
    this.isAreaModalOpen = true;
  }

  openEditArea(area: DiningArea): void {
    this.editingArea = area;
    this.isAreaModalOpen = true;
  }

  onAreaSaved(data: Omit<DiningArea, 'id'>): void {
    if (this.editingArea) {
      this.tablesService.updateArea({ ...data, id: this.editingArea.id })
        .subscribe(() => this.refresh());
      this.toast.success('Area updated');
    } else {
      this.tablesService.createArea(data, this.restaurantId)
        .subscribe(() => this.refresh());
      this.toast.success('Area created');
    }
    this.isAreaModalOpen = false;
    this.editingArea = null;
  }

  onAreaModalClosed(): void {
    this.isAreaModalOpen = false;
    this.editingArea = null;
  }

  requestDeleteArea(area: DiningArea): void {
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    const hasActive = areaTables.some(t => this.hasActiveOrder(t.id));
    if (hasActive) {
      this.toast.error(
        'Some tables in this area have active orders. Please resolve them before deleting.',
      );
      return;
    }
    this.deleteAreaTarget = area;
  }

  confirmDeleteArea(): void {
    if (!this.deleteAreaTarget) return;
    const movedCount = this.tables.filter(
      t => t.areaId === this.deleteAreaTarget!.id,
    ).length;
    this.tablesService.deleteArea(this.deleteAreaTarget.id)
      .subscribe(() => this.refresh());
    this.toast.success(
      `Area deleted. ${movedCount} table(s) unassigned.`,
    );
    this.deleteAreaTarget = null;
  }

  handleAreaActiveToggle(area: DiningArea): void {
    const newActive = !area.isActive;
    this.tablesService.updateArea({ id: area.id, isActive: newActive })
      .subscribe(() => this.refresh());
    // Also toggle all tables in this area
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    for (const t of areaTables) {
      this.tablesService.updateTable({ id: t.id, isActive: newActive }).subscribe();
    }
    this.toast.success(`${area.name} ${newActive ? 'opened' : 'closed'}`);
  }

  // ── Table CRUD ────────────────────────────────────────

  openNewTable(areaId?: string): void {
    this.editingTable = null;
    this.newTableAreaId = areaId;
    this.isTableModalOpen = true;
  }

  openEditTable(table: RestaurantTable): void {
    this.editingTable = table;
    this.newTableAreaId = undefined;
    this.isTableModalOpen = true;
  }

  onTableSaved(data: Partial<RestaurantTable>): void {
    if (this.editingTable) {
      this.tablesService.updateTable({ ...data, id: this.editingTable.id })
        .subscribe(() => this.refresh());
      this.toast.success('Table updated');
    } else {
      // If opened from an area's "Add table" button, pre-set the areaId
      if (this.newTableAreaId && !data.areaId) {
        data.areaId = this.newTableAreaId;
      }
      this.tablesService.createTable(data, this.restaurantId)
        .subscribe(() => this.refresh());
      this.toast.success('Table created');
    }
    this.isTableModalOpen = false;
    this.editingTable = null;
    this.newTableAreaId = undefined;
  }

  onTableModalClosed(): void {
    this.isTableModalOpen = false;
    this.editingTable = null;
    this.newTableAreaId = undefined;
  }

  requestDeleteTable(table: RestaurantTable): void {
    if (this.hasActiveOrder(table.id)) {
      this.toast.error(
        'This table has an active order. Please resolve it before deleting.',
      );
      return;
    }
    this.deleteTableTarget = table;
  }

  confirmDeleteTable(): void {
    if (!this.deleteTableTarget) return;
    this.tablesService.deleteTable(this.deleteTableTarget.id)
      .subscribe(() => this.refresh());
    this.toast.success('Table deleted');
    this.deleteTableTarget = null;
  }

  handleTableActiveToggle(table: RestaurantTable): void {
    this.tablesService.updateTable({
      id: table.id,
      isActive: !table.isActive,
    }).subscribe(() => this.refresh());
    this.toast.success(
      `Table ${table.number} ${!table.isActive ? 'enabled' : 'disabled'}`,
    );
  }

  // ── QR Actions ────────────────────────────────────────

  generateQRForArea(area: DiningArea): void {
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    this.tablesService.bulkUpdateTables(
      areaTables.map(t => t.id),
      { hasQR: true, qrRegeneratedAt: new Date() },
    ).subscribe(() => this.refresh());
    this.toast.success(`QR codes generated for ${area.name}`);
  }

  regenerateQRForArea(area: DiningArea): void {
    const areaTables = this.tables.filter(
      t => t.areaId === area.id && t.hasQR,
    );
    if (areaTables.length === 0) {
      this.toast.error('No tables with QR codes in this area');
      return;
    }
    this.tablesService.bulkUpdateTables(
      areaTables.map(t => t.id),
      { qrRegeneratedAt: new Date() },
    ).subscribe(() => this.refresh());
    this.toast.success(
      `${areaTables.length} QR code(s) regenerated for ${area.name}`,
    );
  }

  // ── Bulk Actions ──────────────────────────────────────

  handleBulkAction(action: string): void {
    switch (action) {
      case 'enable':
        this.tablesService.bulkUpdateTables(this.selectedTableIds, {
          isActive: true,
        }).subscribe(() => this.refresh());
        this.toast.success(
          `${this.selectedTableIds.length} table(s) enabled`,
        );
        break;
      case 'disable':
        this.tablesService.bulkUpdateTables(this.selectedTableIds, {
          isActive: false,
        }).subscribe(() => this.refresh());
        this.toast.success(
          `${this.selectedTableIds.length} table(s) disabled`,
        );
        break;
      case 'generate-qr':
        this.tablesService.bulkUpdateTables(this.selectedTableIds, {
          hasQR: true,
          qrRegeneratedAt: new Date(),
        }).subscribe(() => this.refresh());
        this.toast.success(
          `QR codes generated for ${this.selectedTableIds.length} table(s)`,
        );
        break;
    }
    this.selectedTableIds = [];
    this.showBulkMenu = false;
  }

  // ── Move Tables Dialog ────────────────────────────────

  openMoveDialog(): void {
    this.moveSelectedTableIds = this.getUnassignedTables().map(t => t.id);
    this.moveTargetAreaId = '';
    this.isMoveDialogOpen = true;
  }

  toggleMoveTableSelection(tableId: string): void {
    if (this.moveSelectedTableIds.includes(tableId)) {
      this.moveSelectedTableIds = this.moveSelectedTableIds.filter(
        id => id !== tableId,
      );
    } else {
      this.moveSelectedTableIds = [...this.moveSelectedTableIds, tableId];
    }
  }

  confirmMoveTables(): void {
    if (!this.moveTargetAreaId || this.moveSelectedTableIds.length === 0) return;
    this.tablesService.moveTableToArea(
      this.moveSelectedTableIds,
      this.moveTargetAreaId,
    ).subscribe(() => this.refresh());
    const area = this.areas.find(a => a.id === this.moveTargetAreaId);
    this.toast.success(
      `${this.moveSelectedTableIds.length} table(s) moved to ${area?.name ?? 'area'}`,
    );
    this.isMoveDialogOpen = false;
  }

  // ── QR Preview ─────────────────────────────────────────

  openQrPreview(table: RestaurantTable): void {
    this.qrPreviewTable = table;
    this.isQrModalOpen = true;
  }

  onQrModalClosed(): void {
    this.isQrModalOpen = false;
    this.qrPreviewTable = null;
  }

  onQrRegenerated(): void {
    if (this.qrPreviewTable) {
      this.tablesService.updateTable({
        id: this.qrPreviewTable.id,
        hasQR: true,
        qrRegeneratedAt: new Date(),
      }).subscribe(() => this.refresh());
    }
  }

  getQrPreviewArea(): DiningArea | undefined {
    if (!this.qrPreviewTable?.areaId) return undefined;
    return this.areas.find(a => a.id === this.qrPreviewTable!.areaId);
  }

  // ── QR Row Actions ────────────────────────────────────

  async handleCopyLink(table: RestaurantTable): Promise<void> {
    const url = getTableQRUrl(table);
    try {
      await navigator.clipboard.writeText(url);
      this.toast.success('Link copied to clipboard');
    } catch {
      this.toast.error('Failed to copy link');
    }
  }

  async handleDownloadQR(table: RestaurantTable): Promise<void> {
    const url = getTableQRUrl(table);
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'H',
      });
      const link = document.createElement('a');
      link.download = `table-${table.number}-qr.png`;
      link.href = dataUrl;
      link.click();
      this.toast.success('QR code downloaded');
    } catch {
      this.toast.error('Failed to generate QR');
    }
  }

  // ── Regenerate Confirmations ──────────────────────────

  requestRegenerateTable(table: RestaurantTable): void {
    this.regenTableTarget = table;
  }

  confirmRegenerateTable(): void {
    if (!this.regenTableTarget) return;
    this.tablesService.updateTable({
      id: this.regenTableTarget.id,
      hasQR: true,
      qrRegeneratedAt: new Date(),
    }).subscribe(() => this.refresh());
    this.toast.success(
      `QR code regenerated for Table ${this.regenTableTarget.number}`,
    );
    this.regenTableTarget = null;
  }

  requestRegenerateArea(area: DiningArea): void {
    this.regenAreaTarget = area;
  }

  confirmRegenerateArea(): void {
    if (!this.regenAreaTarget) return;
    const areaTables = this.tables.filter(
      t => t.areaId === this.regenAreaTarget!.id && t.hasQR,
    );
    if (areaTables.length === 0) {
      this.toast.error('No tables with QR codes in this area');
      this.regenAreaTarget = null;
      return;
    }
    this.tablesService.bulkUpdateTables(
      areaTables.map(t => t.id),
      { qrRegeneratedAt: new Date() },
    ).subscribe(() => this.refresh());
    this.toast.success(
      `${areaTables.length} QR code(s) regenerated for ${this.regenAreaTarget.name}`,
    );
    this.regenAreaTarget = null;
  }

  confirmRegenerateAll(): void {
    const activeTables = this.tables.filter(t => t.hasQR);
    this.tablesService.bulkUpdateTables(
      activeTables.map(t => t.id),
      { qrRegeneratedAt: new Date() },
    ).subscribe(() => this.refresh());
    this.toast.success(
      `${activeTables.length} QR code(s) regenerated`,
    );
    this.isRegenAllOpen = false;
  }

  // ── Print Sheet ───────────────────────────────────────

  downloadPrintSheet(area: DiningArea): void {
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    const withQR = areaTables.filter(t => t.hasQR);
    if (withQR.length === 0) {
      this.toast.error('No tables with QR codes in this area');
      return;
    }
    generateQRPrintSheet(areaTables, area);
    this.toast.success(`Print sheet opened for ${area.name}`);
  }

  // ── Helpers ───────────────────────────────────────────

  getTableDisplayName(table: RestaurantTable): string {
    return table.displayName || `Table ${table.number}`;
  }
}
