import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { TooltipDirective } from '../../../../_shared/ui/tooltip/tooltip.directive';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { LocalStorageService } from '../../../../_services/storage/local-storage.service';
import { PersistedValue } from '../../../../_services/storage/persisted-state';
import {
  Reservation,
  WaitlistEntry,
  SeatedParty,
  RestaurantTable,
  DiningArea,
  Server,
} from '../../models/tables.models';

type TabType = 'reservations' | 'waitlist' | 'seated';

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-success/10 text-success border-success/20',
  arrived: 'bg-primary/10 text-primary border-primary/20',
  late: 'bg-warning/10 text-warning border-warning/20',
  no_show: 'bg-destructive/10 text-destructive border-destructive/20',
};

@Component({
  selector: 'app-reservations-pane',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    BadgeComponent,
    DialogComponent,
    TooltipDirective,
  ],
  templateUrl: './reservations-pane.component.html',
})
export class ReservationsPaneComponent {
  @Input() reservations: Reservation[] = [];
  @Input() waitlist: WaitlistEntry[] = [];
  @Input() seatedParties: SeatedParty[] = [];
  @Input() tables: RestaurantTable[] = [];
  @Input() areas: DiningArea[] = [];
  @Input() servers: Server[] = [];

  @Output() newReservation = new EventEmitter<void>();
  @Output() seatReservation = new EventEmitter<{ reservationId: string; tableId: string }>();
  @Output() viewTable = new EventEmitter<string>();
  @Output() editReservation = new EventEmitter<Reservation>();
  @Output() cancelReservation = new EventEmitter<string>();
  @Output() markNoShow = new EventEmitter<string>();
  @Output() seatFromWaitlist = new EventEmitter<{ waitlistId: string; tableId: string }>();

  private readonly _activeTab!: PersistedValue<TabType>;

  get activeTab(): TabType {
    return this._activeTab.value;
  }
  set activeTab(value: TabType) {
    this._activeTab.value = value;
  }

  // Edit reservation dialog
  editingRes: Reservation | null = null;
  editName = '';
  editPartySize = 2;
  editDate = '';
  editTime = '';
  editPhone = '';
  editNotes = '';
  editTableId = '';

  // Confirmation dialogs
  cancelResId: string | null = null;
  noShowResId: string | null = null;

  // Seat from waitlist
  seatWaitlistEntry: WaitlistEntry | null = null;
  seatSuggestedTableId: string | null = null;
  seatOverrideTableId = '';

  // Per-card dropdown
  openMenuId: string | null = null;

  constructor(
    private toast: ToastService,
    private auth: AuthenticationService,
    private localStorage: LocalStorageService,
  ) {
    this._activeTab = new PersistedValue<TabType>('reservations', {
      storage: this.localStorage,
      getKey: () => `tables.reservationsPaneTab:${this.auth.currentRestaurantRole?.restaurant_id ?? 'global'}`,
      validate: (v): v is TabType => v === 'reservations' || v === 'waitlist' || v === 'seated',
    });
  }

  // ── Helpers ───────────────────────────────────────────

  getArea(areaId?: string): DiningArea | undefined {
    return areaId ? this.areas.find(a => a.id === areaId) : undefined;
  }

  getTable(tableId?: string): RestaurantTable | undefined {
    return tableId ? this.tables.find(t => t.id === tableId) : undefined;
  }

  getServer(serverId?: string): Server | undefined {
    return serverId ? this.servers.find(s => s.id === serverId) : undefined;
  }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  getSeatedTime(seatedAt: Date): number {
    return Math.floor((Date.now() - new Date(seatedAt).getTime()) / (60 * 1000));
  }

  getStatusClass(status: string): string {
    return STATUS_COLORS[status] ?? '';
  }

  get activeReservations(): Reservation[] {
    return this.reservations.filter(r => r.status !== 'seated' && r.status !== 'cancelled');
  }

  get availableTables(): RestaurantTable[] {
    return this.tables.filter(t => t.status === 'available' && t.isActive);
  }

  // ── Drag ──────────────────────────────────────────────

  onDragStart(event: DragEvent, resId: string): void {
    event.dataTransfer?.setData('reservationId', resId);
  }

  // ── Seat reservation at first available ───────────────

  seatAtFirstAvailable(res: Reservation): void {
    const available = this.availableTables
      .filter(t => t.maxCapacity >= res.partySize)
      .sort((a, b) => a.maxCapacity - b.maxCapacity);
    if (available.length === 0) {
      this.toast.error('No available tables that fit this party');
      return;
    }
    this.seatReservation.emit({ reservationId: res.id, tableId: available[0].id });
  }

  // ── Edit reservation ─────────────────────────────────

  openEditDialog(res: Reservation): void {
    this.editingRes = res;
    const dt = new Date(res.dateTime);
    this.editName = res.guest.name;
    this.editPhone = res.guest.phone ?? '';
    this.editNotes = res.notes ?? '';
    this.editPartySize = res.partySize;
    this.editDate = dt.toISOString().split('T')[0];
    this.editTime = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
    this.editTableId = res.tableId ?? '';
  }

  handleSaveEdit(): void {
    if (!this.editingRes || !this.editName.trim()) return;

    // Table conflict check
    if (this.editTableId) {
      const editDateTime = new Date(`${this.editDate}T${this.editTime}`);
      const conflict = this.reservations.find(
        r =>
          r.id !== this.editingRes!.id &&
          r.tableId === this.editTableId &&
          r.status !== 'cancelled' &&
          r.status !== 'no_show' &&
          Math.abs(new Date(r.dateTime).getTime() - editDateTime.getTime()) < 2 * 60 * 60 * 1000,
      );
      if (conflict) {
        this.toast.warning(`Table already reserved at that time by ${conflict.guest.name}`);
      }
    }

    const updated: Reservation = {
      ...this.editingRes,
      guest: { ...this.editingRes.guest, name: this.editName.trim(), phone: this.editPhone || undefined },
      dateTime: new Date(`${this.editDate}T${this.editTime}`),
      partySize: this.editPartySize,
      notes: this.editNotes || undefined,
      tableId: this.editTableId || undefined,
    };
    this.editReservation.emit(updated);
    this.editingRes = null;
    this.toast.success('Reservation updated');
  }

  // ── Cancel reservation ────────────────────────────────

  get cancelRes(): Reservation | null {
    return this.cancelResId ? this.reservations.find(r => r.id === this.cancelResId) ?? null : null;
  }

  confirmCancel(): void {
    if (!this.cancelResId) return;
    this.cancelReservation.emit(this.cancelResId);
    this.toast.success('Reservation cancelled');
    this.cancelResId = null;
  }

  // ── No-show ───────────────────────────────────────────

  get noShowRes(): Reservation | null {
    return this.noShowResId ? this.reservations.find(r => r.id === this.noShowResId) ?? null : null;
  }

  confirmNoShow(): void {
    if (!this.noShowResId) return;
    this.markNoShow.emit(this.noShowResId);
    const res = this.noShowRes;
    const tableNum = res?.tableId ? this.getTable(res.tableId)?.number : null;
    this.toast.success(
      tableNum ? `Marked as no-show. Table ${tableNum} is now available.` : 'Marked as no-show',
    );
    this.noShowResId = null;
  }

  // ── Seat from waitlist ────────────────────────────────

  handleSeatBestTable(entry: WaitlistEntry): void {
    const available = this.availableTables
      .filter(t => t.maxCapacity >= entry.partySize)
      .sort((a, b) => a.maxCapacity - b.maxCapacity);
    if (available.length === 0) {
      this.toast.warning('No available tables that fit this party');
      return;
    }
    this.seatWaitlistEntry = entry;
    this.seatSuggestedTableId = available[0].id;
    this.seatOverrideTableId = available[0].id;
  }

  confirmSeatFromWaitlist(): void {
    if (!this.seatWaitlistEntry) return;
    const tableId = this.seatOverrideTableId || this.seatSuggestedTableId;
    if (!tableId) return;
    this.seatFromWaitlist.emit({ waitlistId: this.seatWaitlistEntry.id, tableId });
    const table = this.getTable(tableId);
    this.toast.success(`${this.seatWaitlistEntry.guest.name} seated at Table ${table?.number}`);
    this.seatWaitlistEntry = null;
  }
}
