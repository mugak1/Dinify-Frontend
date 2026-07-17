import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
} from '@angular/core';

import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { TooltipDirective } from '../../../../_shared/ui/tooltip/tooltip.directive';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import {
  RestaurantTable,
  DiningArea,
  SeatedParty,
  Server,
  Reservation,
  TableStatus,
} from '../../models/tables.models';

export const STATUS_COLORS: Record<TableStatus, { bg: string; border: string; text: string }> = {
  available: { bg: 'bg-success/20', border: 'border-success', text: 'text-success' },
  seated: { bg: 'bg-destructive/20', border: 'border-destructive', text: 'text-destructive' },
  bill_requested: { bg: 'bg-warning/20', border: 'border-warning', text: 'text-warning' },
  dirty: { bg: 'bg-muted', border: 'border-muted-foreground/50', text: 'text-muted-foreground' },
  out_of_service: { bg: 'bg-muted/80', border: 'border-muted-foreground/30', text: 'text-muted-foreground' },
};

@Component({
  selector: 'app-floor-plan-canvas',
  standalone: true,
  imports: [ButtonComponent, BadgeComponent, TooltipDirective],
  templateUrl: './floor-plan-canvas.component.html',
})
export class FloorPlanCanvasComponent {
  @Input() tables: RestaurantTable[] = [];
  @Input() areas: DiningArea[] = [];
  @Input() seatedParties: SeatedParty[] = [];
  @Input() servers: Server[] = [];
  @Input() selectedTableId: string | null = null;
  @Input() selectedTableIds: string[] = [];
  @Input() reservations: Reservation[] = [];
  @Output() tableSelect = new EventEmitter<{ tableId: string; isMultiSelect: boolean }>();
  @Output() seatReservation = new EventEmitter<{ reservationId: string; tableId: string }>();
  @Output() tablesChange = new EventEmitter<RestaurantTable[]>();

  @ViewChild('canvasEl') canvasEl!: ElementRef<HTMLDivElement>;

  zoom = 100;
  isEditMode = false;
  editedPositions: Record<string, { x: number; y: number }> = {};
  newTables: RestaurantTable[] = [];
  draggingId: string | null = null;
  dragStart: { x: number; y: number; tableX: number; tableY: number } | null = null;

  constructor(private toast: ToastService) {}

  // ── Computed ──────────────────────────────────────────

  get allTables(): RestaurantTable[] {
    return [...this.tables, ...this.newTables];
  }

  get hasChanges(): boolean {
    return Object.keys(this.editedPositions).length > 0 || this.newTables.length > 0;
  }

  get gridBgSize(): string {
    return `${30 * this.zoom / 100}px ${30 * this.zoom / 100}px`;
  }

  // ── Lookup helpers ────────────────────────────────────

  getServer(serverId?: string): Server | undefined {
    if (!serverId) return undefined;
    return this.servers.find(s => s.id === serverId);
  }

  getParty(tableId: string): SeatedParty | undefined {
    return this.seatedParties.find(p => p.tableId === tableId);
  }

  getArea(areaId?: string): DiningArea | undefined {
    if (!areaId) return undefined;
    return this.areas.find(a => a.id === areaId);
  }

  getReservationForTable(tableId: string): Reservation | undefined {
    return this.reservations.find(
      r => r.tableId === tableId && r.status !== 'seated' && r.status !== 'cancelled',
    );
  }

  getSeatedTime(tableId: string): number | null {
    const party = this.getParty(tableId);
    if (!party) return null;
    return Math.floor((Date.now() - party.seatedAt.getTime()) / (60 * 1000));
  }

  // ── Table display ─────────────────────────────────────

  getDisplayX(table: RestaurantTable): number {
    return (this.editedPositions[table.id]?.x ?? table.x) * this.zoom / 100;
  }

  getDisplayY(table: RestaurantTable): number {
    return (this.editedPositions[table.id]?.y ?? table.y) * this.zoom / 100;
  }

  getDisplayWidth(table: RestaurantTable): number {
    return table.width * this.zoom / 100;
  }

  getDisplayHeight(table: RestaurantTable): number {
    return table.height * this.zoom / 100;
  }

  getColors(status: TableStatus): { bg: string; border: string; text: string } {
    return STATUS_COLORS[status] ?? STATUS_COLORS.available;
  }

  getShapeClass(shape: string): string {
    switch (shape) {
      case 'round': return 'rounded-full';
      case 'bar': return 'rounded-md';
      default: return 'rounded-lg';
    }
  }

  isSelected(tableId: string): boolean {
    return this.selectedTableId === tableId || this.selectedTableIds.includes(tableId);
  }

  getTooltipText(table: RestaurantTable): string {
    const area = this.getArea(table.areaId);
    const party = this.getParty(table.id);
    const seatedTime = this.getSeatedTime(table.id);
    let text = `Table ${table.number}`;
    if (area) text += ` – ${area.name}`;
    text += `\nStatus: ${table.status.replace('_', ' ')}`;
    if (seatedTime !== null) text += ` (${seatedTime} min)`;
    if (party) {
      text += `\nParty: ${party.partySize}`;
      if (party.guest?.name) text += ` – ${party.guest.name}`;
      const server = this.getServer(party.serverId);
      if (server) text += `\nServer: ${server.name}`;
      text += `\nCheck: UGX ${party.currentCheck.toLocaleString()} ${party.isPaid ? '(Paid)' : '(Unpaid)'}`;
    }
    return text;
  }

  getReservationTime(table: RestaurantTable): string | null {
    const res = this.getReservationForTable(table.id);
    if (!res) return null;
    const d = new Date(res.dateTime);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  getDisplayCapacity(table: RestaurantTable): string {
    const party = this.getParty(table.id);
    if (party && table.status === 'seated') return `${party.partySize} seated`;
    return `${table.maxCapacity} seats`;
  }

  // ── Click / select ────────────────────────────────────

  onTableClick(event: MouseEvent, tableId: string): void {
    if (this.isEditMode) return;
    this.tableSelect.emit({ tableId, isMultiSelect: event.shiftKey });
  }

  // ── Drag & drop (reservation seating) ─────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent, table: RestaurantTable): void {
    event.preventDefault();
    const reservationId = event.dataTransfer?.getData('reservationId');
    if (!reservationId) return;
    if (table.status === 'available') {
      this.seatReservation.emit({ reservationId, tableId: table.id });
      this.toast.success(`Reservation seated at Table ${table.number}`);
    } else {
      this.toast.error('Table is not available');
    }
  }

  // ── Edit mode: drag to reposition ─────────────────────

  onEditMouseDown(event: MouseEvent, table: RestaurantTable): void {
    if (!this.isEditMode) return;
    event.preventDefault();
    event.stopPropagation();
    const currentX = this.editedPositions[table.id]?.x ?? table.x;
    const currentY = this.editedPositions[table.id]?.y ?? table.y;
    this.draggingId = table.id;
    this.dragStart = { x: event.clientX, y: event.clientY, tableX: currentX, tableY: currentY };
  }

  onEditMouseMove(event: MouseEvent): void {
    if (!this.draggingId || !this.dragStart || !this.canvasEl) return;
    const rect = this.canvasEl.nativeElement.getBoundingClientRect();
    const dx = ((event.clientX - this.dragStart.x) / rect.width) * 100;
    const dy = ((event.clientY - this.dragStart.y) / rect.height) * 100;
    const newX = Math.max(0, Math.min(95, this.dragStart.tableX + dx));
    const newY = Math.max(0, Math.min(95, this.dragStart.tableY + dy));
    this.editedPositions = {
      ...this.editedPositions,
      [this.draggingId]: { x: newX, y: newY },
    };
  }

  onEditMouseUp(): void {
    this.draggingId = null;
    this.dragStart = null;
  }

  // ── Edit mode: add table ────────────────────────���─────

  handleAddTable(): void {
    const allT = this.allTables;
    const maxNum = allT.length > 0 ? Math.max(...allT.map(t => t.number)) : 0;
    const newTable: RestaurantTable = {
      id: `t-new-${Date.now()}`,
      number: maxNum + 1,
      minCapacity: 2,
      maxCapacity: 4,
      shape: 'square',
      status: 'available',
      tags: [],
      isActive: true,
      hasQR: true,
      qrMode: 'order_pay',
      x: 45,
      y: 45,
      width: 12,
      height: 12,
    };
    this.newTables = [...this.newTables, newTable];
    this.toast.success(`Table ${newTable.number} added – drag to position`);
  }

  // ── Edit mode: save layout ────────────────────────────

  handleSaveLayout(): void {
    const updated = this.allTables.map(t => {
      const pos = this.editedPositions[t.id];
      return pos ? { ...t, x: pos.x, y: pos.y } : t;
    });
    this.tablesChange.emit(updated);
    this.editedPositions = {};
    this.newTables = [];
    this.isEditMode = false;
    // Success/error feedback is now surfaced by the parent once the atomic save
    // resolves — emitting an eager toast here would lie on a failed save.
  }

  // ── Zoom ──────────────────────────────────────────────

  zoomIn(): void {
    this.zoom = Math.min(150, this.zoom + 10);
  }

  zoomOut(): void {
    this.zoom = Math.max(50, this.zoom - 10);
  }
}
