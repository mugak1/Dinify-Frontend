import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { TooltipDirective } from '../../../../_shared/ui/tooltip/tooltip.directive';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import {
  RestaurantTable,
  DiningArea,
  Server,
  SeatedParty,
  Reservation,
  TableStatus,
} from '../../models/tables.models';

const STATUS_COLORS: Record<TableStatus, string> = {
  available: 'bg-success/10 text-success border-success/20',
  seated: 'bg-destructive/10 text-destructive border-destructive/20',
  bill_requested: 'bg-warning/10 text-warning border-warning/20',
  dirty: 'bg-muted text-muted-foreground border-muted-foreground/20',
  out_of_service: 'bg-muted/80 text-muted-foreground border-muted-foreground/20',
};

@Component({
  selector: 'app-table-details-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    BadgeComponent,
    DialogComponent,
    TooltipDirective,
  ],
  templateUrl: './table-details-drawer.component.html',
})
export class TableDetailsDrawerComponent {
  @Input() isOpen = false;
  @Input() tableId: string | null = null;
  @Input() tableIds: string[] = [];
  @Input() tables: RestaurantTable[] = [];
  @Input() areas: DiningArea[] = [];
  @Input() servers: Server[] = [];
  @Input() seatedParties: SeatedParty[] = [];
  @Input() reservations: Reservation[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() markStatus = new EventEmitter<{ tableId: string; status: 'dirty' | 'available' | 'out_of_service' }>();
  @Output() seatWalkIn = new EventEmitter<{ tableId: string; partySize: number }>();
  @Output() transfer = new EventEmitter<string>();
  @Output() markPaid = new EventEmitter<string>();
  @Output() offSystemPay = new EventEmitter<{ tableId: string; method: string; reference?: string }>();
  @Output() addToWaitlist = new EventEmitter<{ guestName: string; partySize: number; phone?: string; notes?: string }>();
  @Output() changeServer = new EventEmitter<{ tableId: string; serverId: string }>();
  @Output() addNote = new EventEmitter<{ tableId: string; note: string }>();
  @Output() mergeTables = new EventEmitter<string[]>();

  // Dialog states
  showOrderModal = false;
  showOffSystemDialog = false;
  showWaitlistDialog = false;
  showNoteDialog = false;
  showServerDialog = false;
  showMergeConfirm = false;

  // Off-system payment form
  offSystemMethod = 'cash';
  offSystemRef = '';

  // Waitlist form
  wlName = '';
  wlPartySize = 2;
  wlPhone = '';
  wlNotes = '';

  // Note form
  noteText = '';

  // Walk-in party size
  walkInSize = 2;

  constructor(private toast: ToastService) {}

  // ── Computed ──────────────────────────────────────────

  get isMultiSelect(): boolean {
    return this.tableIds.length > 1;
  }

  get selectedTables(): RestaurantTable[] {
    if (this.isMultiSelect) {
      return this.tables.filter(t => this.tableIds.includes(t.id));
    }
    if (this.tableId) {
      const t = this.tables.find(tbl => tbl.id === this.tableId);
      return t ? [t] : [];
    }
    return [];
  }

  get table(): RestaurantTable | null {
    return this.selectedTables[0] ?? null;
  }

  get area(): DiningArea | undefined {
    return this.table ? this.areas.find(a => a.id === this.table!.areaId) : undefined;
  }

  get party(): SeatedParty | undefined {
    return this.table ? this.seatedParties.find(p => p.tableId === this.table!.id) : undefined;
  }

  get server(): Server | undefined {
    const serverId = this.party?.serverId ?? this.table?.serverId;
    return serverId ? this.servers.find(s => s.id === serverId) : undefined;
  }

  get reservation(): Reservation | null {
    return this.party?.reservationId
      ? this.reservations.find(r => r.id === this.party!.reservationId) ?? null
      : null;
  }

  get seatedTime(): number | null {
    if (!this.party) return null;
    return Math.floor((Date.now() - new Date(this.party.seatedAt).getTime()) / (60 * 1000));
  }

  get tableName(): string {
    if (!this.table) return '';
    return this.table.displayName || `Table ${this.table.number}`;
  }

  getStatusClass(status: TableStatus): string {
    return STATUS_COLORS[status] ?? '';
  }

  getOrderItemStatusClass(status: string): string {
    switch (status) {
      case 'served': return 'bg-success/10 text-success';
      case 'ready': return 'bg-warning/10 text-warning';
      case 'in_kitchen': return 'bg-primary/10 text-primary';
      default: return 'bg-muted text-muted-foreground';
    }
  }

  // ── Actions ───────────────────────────────────────────

  onClose(): void {
    this.closed.emit();
  }

  handleMarkDirty(): void {
    if (!this.table) return;
    const newStatus = this.table.status === 'dirty' ? 'available' : 'dirty';
    this.markStatus.emit({ tableId: this.table.id, status: newStatus as any });
    this.toast.success(`${this.tableName} marked as ${newStatus}`);
  }

  handleToggleDisable(): void {
    if (!this.table) return;
    const newStatus = this.table.status === 'out_of_service' ? 'available' : 'out_of_service';
    this.markStatus.emit({ tableId: this.table.id, status: newStatus as any });
    this.toast.success(`${this.tableName} ${newStatus === 'out_of_service' ? 'disabled' : 'enabled'}`);
  }

  handleTransfer(): void {
    if (!this.table) return;
    this.transfer.emit(this.table.id);
  }

  handleSeatWalkIn(): void {
    if (!this.table) return;
    this.seatWalkIn.emit({ tableId: this.table.id, partySize: this.walkInSize });
    this.toast.success(`Walk-in party of ${this.walkInSize} seated at ${this.tableName}`);
    this.walkInSize = 2;
  }

  handleMarkPaid(): void {
    if (!this.table) return;
    this.markPaid.emit(this.table.id);
    this.toast.success(`${this.tableName} marked as paid and cleared`);
  }

  handleOffSystemSubmit(): void {
    if (!this.table) return;
    this.offSystemPay.emit({
      tableId: this.table.id,
      method: this.offSystemMethod,
      reference: this.offSystemRef || undefined,
    });
    this.toast.success(`Off-system payment recorded (${this.offSystemMethod})`);
    this.showOffSystemDialog = false;
    this.offSystemMethod = 'cash';
    this.offSystemRef = '';
  }

  handleWaitlistSubmit(): void {
    if (!this.wlName.trim()) return;
    this.addToWaitlist.emit({
      guestName: this.wlName.trim(),
      partySize: this.wlPartySize,
      phone: this.wlPhone || undefined,
      notes: this.wlNotes || undefined,
    });
    this.toast.success(`${this.wlName} added to waitlist`);
    this.showWaitlistDialog = false;
    this.wlName = '';
    this.wlPartySize = 2;
    this.wlPhone = '';
    this.wlNotes = '';
  }

  handleServerChange(serverId: string): void {
    if (!this.table) return;
    this.changeServer.emit({ tableId: this.table.id, serverId });
    const srv = this.servers.find(s => s.id === serverId);
    this.toast.success(`Server changed to ${srv?.name ?? 'Unknown'}`);
    this.showServerDialog = false;
  }

  handleNoteSave(): void {
    if (!this.table) return;
    this.addNote.emit({ tableId: this.table.id, note: this.noteText });
    this.toast.success(this.noteText ? 'Note saved' : 'Note cleared');
    this.showNoteDialog = false;
    this.noteText = '';
  }

  handleStubAction(action: string): void {
    this.toast.info(`${action} — coming in a future release`);
  }

  // ── Print bill ────────────────────────────────────────

  handlePrintBill(): void {
    if (!this.table || !this.party) return;
    const items = this.party.orderItems
      .map(i => `<tr><td>${i.quantity}× ${i.name}</td><td style="text-align:right">${i.status}</td></tr>`)
      .join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bill – ${this.tableName}</title>
        <style>
          body { font-family: 'Courier New', monospace; width: 300px; margin: 20px auto; font-size: 12px; }
          h2 { text-align: center; margin-bottom: 4px; }
          .sub { text-align: center; color: #666; margin-bottom: 16px; font-size: 11px; }
          hr { border: none; border-top: 1px dashed #ccc; margin: 12px 0; }
          table { width: 100%; }
          td { padding: 2px 0; }
          .total { font-weight: bold; font-size: 14px; }
          .footer { text-align: center; color: #888; margin-top: 16px; font-size: 10px; }
        </style>
      </head>
      <body>
        <h2>${this.tableName}</h2>
        <div class="sub">${this.area?.name ?? ''} &middot; Party of ${this.party.partySize}</div>
        <hr/>
        <table>${items}</table>
        <hr/>
        <table><tr class="total"><td>TOTAL</td><td style="text-align:right">UGX ${this.party.currentCheck.toLocaleString()}</td></tr></table>
        <hr/>
        <div class="footer">Thank you for dining with us!</div>
        <script>window.onload = () => { window.print(); window.close(); };</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  // ── Multi-select bulk actions ─────────────────────────

  handleBulkMarkDirty(): void {
    for (const t of this.selectedTables) {
      this.markStatus.emit({ tableId: t.id, status: 'dirty' });
    }
    this.toast.success(`${this.selectedTables.length} table(s) marked dirty`);
  }

  handleBulkOutOfService(): void {
    for (const t of this.selectedTables) {
      this.markStatus.emit({ tableId: t.id, status: 'out_of_service' });
    }
    this.toast.success(`${this.selectedTables.length} table(s) marked out of service`);
  }

  handleMergeConfirm(): void {
    this.mergeTables.emit(this.tableIds);
    this.toast.success(`Tables ${this.selectedTables.map(t => t.number).join(', ')} merged`);
    this.showMergeConfirm = false;
  }

  get mergeTableNumbers(): string {
    return this.selectedTables.map(t => t.number).join(', ');
  }

  get primaryTableNumber(): number {
    return this.selectedTables.length > 0 ? this.selectedTables[0].number : 0;
  }

  get mergeHasConflict(): boolean {
    const statuses = new Set(this.selectedTables.map(t => t.status));
    return statuses.size > 1;
  }
}
