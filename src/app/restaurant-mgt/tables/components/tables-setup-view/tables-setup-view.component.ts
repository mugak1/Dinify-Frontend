import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';
import { Subject, combineLatest, forkJoin } from 'rxjs';
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
import {
  BulkAddTablesModalComponent,
  BulkTablesConfig,
} from '../bulk-add-tables-modal/bulk-add-tables-modal.component';
import { QrCodePreviewModalComponent } from '../qr-code-preview-modal/qr-code-preview-modal.component';
import {
  DiningArea,
  RestaurantTable,
} from '../../models/tables.models';
import { generateQRPrintSheet, getTableQRUrl } from '../../utils/qr-print-sheet';
import { computeBulkTableNumbers } from '../../utils/bulk-table-numbers';
import QRCode from 'qrcode';

@Component({
  selector: 'app-tables-setup-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OverlayModule,
    CardComponent,
    ButtonComponent,
    BadgeComponent,
    SwitchComponent,
    DialogComponent,
    TooltipDirective,
    NewAreaModalComponent,
    NewTableModalComponent,
    BulkAddTablesModalComponent,
    QrCodePreviewModalComponent,
  ],
  templateUrl: './tables-setup-view.component.html',
  host: { class: 'block' },
})
export class TablesSetupViewComponent implements OnInit, OnDestroy {
  areas: DiningArea[] = [];
  tables: RestaurantTable[] = [];

  // Initial-load state (drives the loading skeleton / retryable error region)
  loading = false;
  loadError: string | null = null;

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

  // Bulk add tables modal
  isBulkTableModalOpen = false;

  // Delete confirmations
  deleteTableTarget: RestaurantTable | null = null;
  deleteAreaTarget: DiningArea | null = null;

  // Move dialog
  isMoveDialogOpen = false;
  moveTargetAreaId = '';
  moveSelectedTableIds: string[] = [];

  // Bulk actions dropdown
  showBulkMenu = false;

  /** Right-aligned dropdown: below the trigger, flipping above if it won't fit. */
  readonly bulkMenuPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  // QR preview
  qrPreviewTable: RestaurantTable | null = null;
  isQrModalOpen = false;

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

    // Load initial data — areas first so getTables() can build its
    // tableId → areaId lookup from the current areas$ state.
    this.refresh();
  }

  private refresh(): void {
    this.loading = true;
    this.loadError = null;
    this.tablesService.getAreas(this.restaurantId).pipe(
      switchMap(() => this.tablesService.getTables(this.restaurantId)),
    ).subscribe({
      next: () => {
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.loadError = this.extractError(
          err,
          'Could not load tables. Please try again.',
        );
      },
    });
  }

  /** Re-attempt the load after a failure (template Retry button). */
  reload(): void {
    this.refresh();
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
      this.tablesService.updateArea({ ...data, id: this.editingArea.id }).subscribe({
        next: () => {
          this.refresh();
          this.toast.success('Area updated');
        },
        error: (err) => {
          this.toast.clear();
          this.toast.error(
            this.extractError(err, 'Could not update the area. Please try again.'),
          );
        },
      });
    } else {
      this.tablesService.createArea(data, this.restaurantId).subscribe({
        next: () => {
          this.refresh();
          this.toast.success('Area created');
        },
        error: (err) => {
          this.toast.clear();
          this.toast.error(
            this.extractError(err, 'Could not create the area. Please try again.'),
          );
        },
      });
    }
    this.isAreaModalOpen = false;
    this.editingArea = null;
  }

  onAreaModalClosed(): void {
    this.isAreaModalOpen = false;
    this.editingArea = null;
  }

  requestDeleteArea(area: DiningArea): void {
    this.deleteAreaTarget = area;
  }

  confirmDeleteArea(): void {
    if (!this.deleteAreaTarget) return;
    this.tablesService.deleteArea(this.deleteAreaTarget.id).subscribe({
      next: () => {
        this.refresh();
        this.toast.success('Area deleted');
      },
      error: (err) => {
        // The interceptor already queued this as a toast; clear it so only one
        // clean toast shows.
        this.toast.clear();
        this.toast.error(
          this.extractError(err, 'Could not delete this area. Please try again.'),
        );
      },
    });
    this.deleteAreaTarget = null;
  }

  handleAreaActiveToggle(area: DiningArea): void {
    const newActive = !area.isActive;
    // Toggle the area together with all its tables. The success toast must wait
    // for every call, so fan them into one forkJoin (always ≥1 element, so it
    // never completes empty); a single failure surfaces one clean error.
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    forkJoin([
      this.tablesService.updateArea({ id: area.id, isActive: newActive }),
      ...areaTables.map(t =>
        this.tablesService.updateTable({ id: t.id, isActive: newActive }),
      ),
    ]).subscribe({
      next: () => {
        this.refresh();
        this.toast.success(`${area.name} ${newActive ? 'opened' : 'closed'}`);
      },
      error: (err) => {
        this.toast.clear();
        this.toast.error(
          this.extractError(err, `Could not update ${area.name}. Please try again.`),
        );
      },
    });
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
      this.tablesService.updateTable({ ...data, id: this.editingTable.id }).subscribe({
        next: () => {
          this.refresh();
          this.toast.success('Table updated');
        },
        error: (err) => {
          this.toast.clear();
          this.toast.error(
            this.extractError(err, 'Could not update the table. Please try again.'),
          );
        },
      });
    } else {
      // If opened from an area's "Add table" button, pre-set the areaId
      if (this.newTableAreaId && !data.areaId) {
        data.areaId = this.newTableAreaId;
      }
      this.tablesService.createTable(data, this.restaurantId).subscribe({
        next: () => {
          this.refresh();
          this.toast.success('Table created');
        },
        error: (err) => {
          this.toast.clear();
          this.toast.error(
            this.extractError(err, 'Could not create the table. Please try again.'),
          );
        },
      });
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

  // ── Bulk Add Tables ───────────────────────────────────

  /** Numbers used by loaded tables — feeds the modal's smart default + preview. */
  get existingTableNumbers(): number[] {
    return this.tables.map(t => t.number);
  }

  openBulkTables(): void {
    this.isBulkTableModalOpen = true;
  }

  onBulkTablesModalClosed(): void {
    this.isBulkTableModalOpen = false;
  }

  onBulkTablesSaved(config: BulkTablesConfig): void {
    this.isBulkTableModalOpen = false;
    // Recompute the split here against the live table list — the component owns
    // the source of truth, not the modal (the list may have changed since open).
    const { toCreate, skipped } = computeBulkTableNumbers(
      config.start,
      config.count,
      this.tables.map(t => t.number),
    );
    if (toCreate.length === 0) {
      this.toast.error('No new table numbers to create.');
      return;
    }

    const specs: Partial<RestaurantTable>[] = toCreate.map(number => ({
      number,
      areaId: config.areaId,
      minCapacity: config.minCapacity,
      maxCapacity: config.maxCapacity,
      shape: config.shape,
      tags: [],
      isActive: true,
      hasQR: config.generateQR,
      qrMode: config.generateQR ? config.qrMode : undefined,
      qrRegeneratedAt: config.generateQR ? new Date() : undefined,
    }));

    this.tablesService.bulkCreateTables(specs, this.restaurantId).subscribe(results => {
      const created = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok);
      // Each failed POST queues its own toast via the interceptor; clear them so
      // only this single aggregate toast shows.
      if (failed.length) this.toast.clear();
      this.refresh();

      const parts = [`Created ${created} table(s)`];
      if (skipped.length) {
        parts.push(`skipped ${skipped.length} already-existing: ${skipped.join(', ')}`);
      }
      if (failed.length) {
        parts.push(`${failed.length} failed: ${failed.map(f => f.number).join(', ')}`);
      }
      const msg = parts.join('; ');
      if (failed.length) {
        this.toast.error(msg);
      } else {
        this.toast.success(msg);
      }
    });
  }

  requestDeleteTable(table: RestaurantTable): void {
    this.deleteTableTarget = table;
  }

  confirmDeleteTable(): void {
    if (!this.deleteTableTarget) return;
    this.tablesService.deleteTable(this.deleteTableTarget.id).subscribe({
      next: () => {
        this.refresh();
        this.toast.success('Table deleted');
      },
      error: (err) => {
        // The interceptor already queued this as a toast; clear it so only one
        // clean toast shows.
        this.toast.clear();
        this.toast.error(
          this.extractError(err, 'Could not delete this table. Please try again.'),
        );
      },
    });
    this.deleteTableTarget = null;
  }

  /**
   * Pull a user-facing message out of a failed delete. The error interceptor
   * re-throws the backend message as a plain string, but guard against the
   * structured HttpErrorResponse shape too; fall back to a clear default so a
   * blocked delete never produces a blank/generic toast.
   */
  private extractError(err: unknown, fallback: string): string {
    if (typeof err === 'string' && err.trim()) return err;
    const e = err as { error?: { message?: string }; message?: string } | null;
    return e?.error?.message || e?.message || fallback;
  }

  handleTableActiveToggle(table: RestaurantTable): void {
    const enabling = !table.isActive;
    this.tablesService.updateTable({ id: table.id, isActive: enabling }).subscribe({
      next: () => {
        this.refresh();
        this.toast.success(
          `Table ${table.number} ${enabling ? 'enabled' : 'disabled'}`,
        );
      },
      error: (err) => {
        this.toast.clear();
        this.toast.error(
          this.extractError(
            err,
            `Could not update Table ${table.number}. Please try again.`,
          ),
        );
      },
    });
  }

  // ── QR Actions ────────────────────────────────────────

  generateQRForArea(area: DiningArea): void {
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    this.tablesService.bulkUpdateTables(
      areaTables.map(t => t.id),
      { hasQR: true, qrRegeneratedAt: new Date() },
    ).subscribe({
      next: () => {
        this.refresh();
        this.toast.success(`QR codes generated for ${area.name}`);
      },
      error: (err) => {
        this.toast.clear();
        this.toast.error(
          this.extractError(
            err,
            `Could not generate QR codes for ${area.name}. Please try again.`,
          ),
        );
      },
    });
  }

  // ── Bulk Actions ──────────────────────────────────────

  handleBulkAction(action: string): void {
    // Capture the selection up front — it's cleared synchronously below, so the
    // deferred success toast must read a captured count, not the live array.
    const ids = this.selectedTableIds;
    const count = ids.length;
    const onError = (err: unknown) => {
      this.toast.clear();
      this.toast.error(
        this.extractError(
          err,
          'Could not update the selected tables. Please try again.',
        ),
      );
    };
    switch (action) {
      case 'enable':
        this.tablesService.bulkUpdateTables(ids, { isActive: true }).subscribe({
          next: () => {
            this.refresh();
            this.toast.success(`${count} table(s) enabled`);
          },
          error: onError,
        });
        break;
      case 'disable':
        this.tablesService.bulkUpdateTables(ids, { isActive: false }).subscribe({
          next: () => {
            this.refresh();
            this.toast.success(`${count} table(s) disabled`);
          },
          error: onError,
        });
        break;
      case 'generate-qr':
        this.tablesService.bulkUpdateTables(ids, {
          hasQR: true,
          qrRegeneratedAt: new Date(),
        }).subscribe({
          next: () => {
            this.refresh();
            this.toast.success(`QR codes generated for ${count} table(s)`);
          },
          error: onError,
        });
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
    const count = this.moveSelectedTableIds.length;
    const areaName =
      this.areas.find(a => a.id === this.moveTargetAreaId)?.name ?? 'area';
    this.tablesService.moveTableToArea(
      this.moveSelectedTableIds,
      this.moveTargetAreaId,
    ).subscribe({
      next: () => {
        this.refresh();
        this.toast.success(`${count} table(s) moved to ${areaName}`);
      },
      error: (err) => {
        this.toast.clear();
        this.toast.error(
          this.extractError(
            err,
            'Could not move the selected tables. Please try again.',
          ),
        );
      },
    });
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

  // ── Print Sheet ───────────────────────────────────────

  downloadPrintSheet(area: DiningArea): void {
    const areaTables = this.tables.filter(t => t.areaId === area.id);
    const withQR = areaTables.filter(t => t.hasQR);
    if (withQR.length === 0) {
      this.toast.error('No tables with QR codes in this area');
      return;
    }
    // Fire-and-forget: the print window opens synchronously inside this gesture
    // (popup-safe); QR data URLs fill it a moment later.
    void generateQRPrintSheet(areaTables, area);
    this.toast.success(`Print sheet opened for ${area.name}`);
  }

  // ── Helpers ───────────────────────────────────────────

  getTableDisplayName(table: RestaurantTable): string {
    return table.displayName || `Table ${table.number}`;
  }
}
