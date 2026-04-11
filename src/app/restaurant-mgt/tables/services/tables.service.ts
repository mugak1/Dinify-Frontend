import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { delay, map, tap } from 'rxjs/operators';
import { ApiService } from '../../../_services/api.service';
import {
  DiningArea,
  RestaurantTable,
  Reservation,
  WaitlistEntry,
  SeatedParty,
  Server,
  TableStatus,
} from '../models/tables.models';
import {
  mockAreas,
  mockTables,
  mockReservations,
  mockWaitlist,
  mockServers,
  mockSeatedParties,
} from '../data/tables-mock-data';

/** Set to false to use real API endpoints instead of mock data */
const USE_MOCK_DATA = true;

@Injectable({ providedIn: 'root' })
export class TablesService {
  // ── Reactive state ────────────────────────────────────
  areas$ = new BehaviorSubject<DiningArea[]>([]);
  tables$ = new BehaviorSubject<RestaurantTable[]>([]);
  reservations$ = new BehaviorSubject<Reservation[]>([]);
  waitlist$ = new BehaviorSubject<WaitlistEntry[]>([]);

  constructor(private api: ApiService) {}

  // ── Read methods ──────────────────────────────────────

  getAreas(restaurantId: string): Observable<DiningArea[]> {
    if (USE_MOCK_DATA) {
      return of(mockAreas).pipe(
        delay(300),
        tap(areas => this.areas$.next(areas)),
      );
    }
    return this.api.get<any>(null, 'restaurant-setup/diningareas/', {
      restaurant: restaurantId,
    }).pipe(
      tap((res: any) => this.areas$.next(res?.data ?? [])),
    );
  }

  getTables(restaurantId: string): Observable<RestaurantTable[]> {
    if (USE_MOCK_DATA) {
      return of(mockTables).pipe(
        delay(300),
        tap(tables => this.tables$.next(tables)),
      );
    }
    return this.api.get<any>(null, 'restaurant-setup/tables/', {
      restaurant: restaurantId,
    }).pipe(
      tap((res: any) => this.tables$.next(res?.data ?? [])),
    );
  }

  getReservations(restaurantId: string, _date?: string): Observable<Reservation[]> {
    if (USE_MOCK_DATA) {
      return of(mockReservations).pipe(
        delay(300),
        tap(reservations => this.reservations$.next(reservations)),
      );
    }
    return this.api.get<any>(null, 'tables/reservations/', {
      restaurant: restaurantId,
    }).pipe(
      tap((res: any) => this.reservations$.next(res?.data ?? [])),
    );
  }

  getWaitlist(restaurantId: string): Observable<WaitlistEntry[]> {
    if (USE_MOCK_DATA) {
      return of(mockWaitlist).pipe(
        delay(300),
        tap(entries => this.waitlist$.next(entries)),
      );
    }
    return this.api.get<any>(null, 'tables/waitlist/', {
      restaurant: restaurantId,
    }).pipe(
      tap((res: any) => this.waitlist$.next(res?.data ?? [])),
    );
  }

  getServers(restaurantId: string): Observable<Server[]> {
    if (USE_MOCK_DATA) {
      return of(mockServers).pipe(delay(300));
    }
    return this.api.get<any>(null, 'tables/servers/', {
      restaurant: restaurantId,
    }).pipe(map((res: any) => res?.data ?? []));
  }

  // ── Mutation methods ──────────────────────────────────

  updateTableStatus(tableId: string, status: TableStatus): void {
    if (USE_MOCK_DATA) {
      const tables = this.tables$.value.map(t =>
        t.id === tableId ? { ...t, status } : t,
      );
      this.tables$.next(tables);
      return;
    }
    // TODO: real API call
  }

  seatWalkIn(tableId: string, partySize: number, guestName?: string): void {
    if (USE_MOCK_DATA) {
      this.updateTableStatus(tableId, 'seated');
      const parties = [...mockSeatedParties, {
        id: `seated-walkin-${Date.now()}`,
        tableId,
        guest: guestName ? { name: guestName } : undefined,
        partySize,
        adults: partySize,
        children: 0,
        seatedAt: new Date(),
        serverId: this.tables$.value.find(t => t.id === tableId)?.serverId ?? 'srv-1',
        currentCheck: 0,
        isPaid: false,
        orderItems: [],
      }];
      // Update the mock source for helper functions
      mockSeatedParties.length = 0;
      mockSeatedParties.push(...parties);
      return;
    }
    // TODO: real API call
  }

  transferTable(sourceId: string, destId: string): void {
    if (USE_MOCK_DATA) {
      const party = mockSeatedParties.find(p => p.tableId === sourceId);
      if (party) {
        party.tableId = destId;
        this.updateTableStatus(sourceId, 'dirty');
        this.updateTableStatus(destId, 'seated');
      }
      return;
    }
    // TODO: real API call
  }

  createReservation(data: Partial<Reservation>): void {
    if (USE_MOCK_DATA) {
      const reservation: Reservation = {
        id: `res-${Date.now()}`,
        guest: data.guest ?? { name: 'Guest' },
        dateTime: data.dateTime ?? new Date(),
        partySize: data.partySize ?? 2,
        status: 'confirmed',
        tags: data.tags ?? {},
        ...data,
      } as Reservation;
      this.reservations$.next([...this.reservations$.value, reservation]);
      return;
    }
    // TODO: real API call
  }

  updateReservation(data: Partial<Reservation> & { id: string }): void {
    if (USE_MOCK_DATA) {
      const reservations = this.reservations$.value.map(r =>
        r.id === data.id ? { ...r, ...data } : r,
      );
      this.reservations$.next(reservations);
      return;
    }
    // TODO: real API call
  }

  cancelReservation(id: string): void {
    if (USE_MOCK_DATA) {
      const reservations = this.reservations$.value.map(r =>
        r.id === id ? { ...r, status: 'cancelled' as const } : r,
      );
      this.reservations$.next(reservations);
      return;
    }
    // TODO: real API call
  }

  markNoShow(id: string): void {
    if (USE_MOCK_DATA) {
      const reservations = this.reservations$.value.map(r =>
        r.id === id ? { ...r, status: 'no_show' as const } : r,
      );
      this.reservations$.next(reservations);
      return;
    }
    // TODO: real API call
  }

  seatFromWaitlist(waitlistId: string, tableId: string): void {
    if (USE_MOCK_DATA) {
      const entry = this.waitlist$.value.find(w => w.id === waitlistId);
      if (entry) {
        this.waitlist$.next(this.waitlist$.value.filter(w => w.id !== waitlistId));
        this.seatWalkIn(tableId, entry.partySize, entry.guest.name);
      }
      return;
    }
    // TODO: real API call
  }

  addToWaitlist(data: Partial<WaitlistEntry>): void {
    if (USE_MOCK_DATA) {
      const entry: WaitlistEntry = {
        id: `wait-${Date.now()}`,
        guest: data.guest ?? { name: 'Guest' },
        partySize: data.partySize ?? 2,
        quotedWaitMinutes: data.quotedWaitMinutes ?? { min: 15, max: 30 },
        addedAt: new Date(),
        tags: data.tags ?? {},
      };
      this.waitlist$.next([...this.waitlist$.value, entry]);
      return;
    }
    // TODO: real API call
  }

  updateFloorPlan(tablePositions: { id: string; x: number; y: number }[]): void {
    if (USE_MOCK_DATA) {
      const tables = this.tables$.value.map(t => {
        const pos = tablePositions.find(p => p.id === t.id);
        return pos ? { ...t, x: pos.x, y: pos.y } : t;
      });
      this.tables$.next(tables);
      return;
    }
    // TODO: real API call
  }

  // ── Setup CRUD methods ────────────────────────────────

  createArea(data: Partial<DiningArea>): void {
    if (USE_MOCK_DATA) {
      const area: DiningArea = {
        id: `area-${Date.now()}`,
        name: data.name ?? 'New Area',
        description: data.description,
        isIndoor: data.isIndoor ?? true,
        smokingAllowed: data.smokingAllowed ?? false,
        accessible: data.accessible ?? false,
        defaultServerSection: data.defaultServerSection,
        isActive: data.isActive ?? true,
        tableIds: data.tableIds ?? [],
      };
      this.areas$.next([...this.areas$.value, area]);
      // Assign tables to this area
      if (area.tableIds.length > 0) {
        const tables = this.tables$.value.map(t =>
          area.tableIds.includes(t.id) ? { ...t, areaId: area.id } : t,
        );
        this.tables$.next(tables);
      }
      return;
    }
    // TODO: real API call
  }

  updateArea(data: Partial<DiningArea> & { id: string }): void {
    if (USE_MOCK_DATA) {
      const oldArea = this.areas$.value.find(a => a.id === data.id);
      const oldTableIds = oldArea?.tableIds ?? [];
      const newTableIds = data.tableIds ?? oldTableIds;

      this.areas$.next(
        this.areas$.value.map(a => (a.id === data.id ? { ...a, ...data } : a)),
      );
      // Unassign removed tables, assign new ones
      const removed = oldTableIds.filter(id => !newTableIds.includes(id));
      const added = newTableIds.filter(id => !oldTableIds.includes(id));
      if (removed.length > 0 || added.length > 0) {
        const tables = this.tables$.value.map(t => {
          if (removed.includes(t.id)) return { ...t, areaId: undefined };
          if (added.includes(t.id)) return { ...t, areaId: data.id };
          return t;
        });
        this.tables$.next(tables);
      }
      return;
    }
    // TODO: real API call
  }

  deleteArea(id: string): void {
    if (USE_MOCK_DATA) {
      this.areas$.next(this.areas$.value.filter(a => a.id !== id));
      // Unassign tables from deleted area
      const tables = this.tables$.value.map(t =>
        t.areaId === id ? { ...t, areaId: undefined } : t,
      );
      this.tables$.next(tables);
      return;
    }
    // TODO: real API call
  }

  createTable(data: Partial<RestaurantTable>): void {
    if (USE_MOCK_DATA) {
      const table: RestaurantTable = {
        id: `t-${Date.now()}`,
        number: data.number ?? 0,
        displayName: data.displayName,
        areaId: data.areaId,
        minCapacity: data.minCapacity ?? 2,
        maxCapacity: data.maxCapacity ?? 4,
        shape: data.shape ?? 'square',
        status: 'available',
        tags: data.tags ?? [],
        isActive: data.isActive ?? true,
        hasQR: data.hasQR ?? false,
        qrMode: data.qrMode,
        qrRegeneratedAt: data.hasQR ? new Date() : undefined,
        x: 50,
        y: 50,
        width: 10,
        height: 10,
      };
      this.tables$.next([...this.tables$.value, table]);
      // Add to area if assigned
      if (table.areaId) {
        this.areas$.next(
          this.areas$.value.map(a =>
            a.id === table.areaId
              ? { ...a, tableIds: [...a.tableIds, table.id] }
              : a,
          ),
        );
      }
      return;
    }
    // TODO: real API call
  }

  updateTable(data: Partial<RestaurantTable> & { id: string }): void {
    if (USE_MOCK_DATA) {
      const oldTable = this.tables$.value.find(t => t.id === data.id);
      const oldAreaId = oldTable?.areaId;
      const newAreaId = data.areaId;

      this.tables$.next(
        this.tables$.value.map(t => (t.id === data.id ? { ...t, ...data } : t)),
      );

      // Update area tableIds if area changed
      if (oldAreaId !== newAreaId) {
        let areas = this.areas$.value;
        if (oldAreaId) {
          areas = areas.map(a =>
            a.id === oldAreaId
              ? { ...a, tableIds: a.tableIds.filter(id => id !== data.id) }
              : a,
          );
        }
        if (newAreaId) {
          areas = areas.map(a =>
            a.id === newAreaId
              ? { ...a, tableIds: [...a.tableIds, data.id] }
              : a,
          );
        }
        this.areas$.next(areas);
      }
      return;
    }
    // TODO: real API call
  }

  deleteTable(id: string): void {
    if (USE_MOCK_DATA) {
      const table = this.tables$.value.find(t => t.id === id);
      this.tables$.next(this.tables$.value.filter(t => t.id !== id));
      // Remove from area
      if (table?.areaId) {
        this.areas$.next(
          this.areas$.value.map(a =>
            a.id === table.areaId
              ? { ...a, tableIds: a.tableIds.filter(tid => tid !== id) }
              : a,
          ),
        );
      }
      return;
    }
    // TODO: real API call
  }

  bulkUpdateTables(ids: string[], changes: Partial<RestaurantTable>): void {
    if (USE_MOCK_DATA) {
      const tables = this.tables$.value.map(t =>
        ids.includes(t.id) ? { ...t, ...changes } : t,
      );
      this.tables$.next(tables);
      return;
    }
    // TODO: real API call
  }

  moveTableToArea(tableIds: string[], areaId: string): void {
    if (USE_MOCK_DATA) {
      // Remove from old areas
      let areas = this.areas$.value.map(a => ({
        ...a,
        tableIds: a.tableIds.filter(id => !tableIds.includes(id)),
      }));
      // Add to new area
      areas = areas.map(a =>
        a.id === areaId ? { ...a, tableIds: [...a.tableIds, ...tableIds] } : a,
      );
      this.areas$.next(areas);
      // Update tables
      const tables = this.tables$.value.map(t =>
        tableIds.includes(t.id) ? { ...t, areaId } : t,
      );
      this.tables$.next(tables);
      return;
    }
    // TODO: real API call
  }

  getSeatedParties(): SeatedParty[] {
    return mockSeatedParties;
  }
}
