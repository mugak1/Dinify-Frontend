// ── Status & shape enums ──────────────────────────────────
export type TableStatus = 'available' | 'seated' | 'bill_requested' | 'dirty' | 'out_of_service';
export type TableShape = 'round' | 'square' | 'rectangle' | 'bar';
export type ReservationStatus = 'confirmed' | 'arrived' | 'late' | 'no_show' | 'seated' | 'cancelled';
export type QRMode = 'menu_only' | 'order_pay' | 'order_only';

// ── Tag ───────────────────────────────────────────────────
export interface TableTag {
  id: string;
  label: string;
}

// ── Dining area ───────────────────────────────────────────
export interface DiningArea {
  id: string;
  name: string;
  description?: string;
  isIndoor: boolean;
  smokingAllowed: boolean;
  accessible: boolean;
  defaultServerSection?: string;
  isActive: boolean;
  tableIds: string[];
}

// ── Table ─────────────────────────────────────────────────
export interface RestaurantTable {
  id: string;
  number: number;
  displayName?: string;
  areaId?: string;
  minCapacity: number;
  maxCapacity: number;
  shape: TableShape;
  status: TableStatus;
  tags: string[];
  isActive: boolean;
  hasQR: boolean;
  qrMode?: QRMode;
  qrRegeneratedAt?: Date;
  serverId?: string;
  // Position on floor plan (percentage based)
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Server ────────────────────────────────────────────────
export interface Server {
  id: string;
  name: string;
  initials: string;
  section?: string;
}

// ── Guest ─────────────────────────────────────────────────
export interface Guest {
  name: string;
  phone?: string;
  email?: string;
}

// ── Reservation ───────────────────────────────────────────
export interface Reservation {
  id: string;
  guest: Guest;
  dateTime: Date;
  partySize: number;
  status: ReservationStatus;
  tableId?: string;
  areaPreference?: string;
  notes?: string;
  tags: {
    birthday?: boolean;
    anniversary?: boolean;
    vip?: boolean;
    allergy?: boolean;
    nonSmoking?: boolean;
  };
  seatedAt?: Date;
  serverId?: string;
}

// ── Waitlist ──────────────────────────────────────────────
export interface WaitlistEntry {
  id: string;
  guest: Guest;
  partySize: number;
  quotedWaitMinutes: { min: number; max: number };
  addedAt: Date;
  tags: {
    birthday?: boolean;
    vip?: boolean;
    allergy?: boolean;
  };
}

// ── Seated party ──────────────────────────────────────────
export interface SeatedParty {
  id: string;
  tableId: string;
  guest?: Guest;
  partySize: number;
  adults: number;
  children: number;
  seatedAt: Date;
  serverId: string;
  reservationId?: string;
  currentCheck: number;
  isPaid: boolean;
  orderItems: OrderItem[];
}

// ── Order item ────────────────────────────────────────────
export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  status: 'pending' | 'in_kitchen' | 'ready' | 'served';
}

// ── Filters ───────────────────────────────────────────────
export interface TableFilters {
  area: string;
  status: TableStatus[];
  servers: string[];
  tableSize: number[];
  search: string;
}

// ── Floor plan state ──────────────────────────────────────
export interface FloorPlanState {
  zoom: number;
  isEditMode: boolean;
  selectedTableIds: string[];
}

// ── Snake-case → camelCase mapping utility ────────────────
export function mapSnakeToCamel<T>(obj: Record<string, any>): T {
  const result: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[camelKey] = mapSnakeToCamel(value);
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map(item =>
        item !== null && typeof item === 'object' && !(item instanceof Date)
          ? mapSnakeToCamel(item)
          : item,
      );
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}

// ── API → model mappers ───────────────────────────────────
/**
 * Maps a raw backend table record to the frontend RestaurantTable model.
 * `areaId` must be supplied externally (derived from DiningArea.tables),
 * because the backend's table serializer embeds `dining_area` as a
 * name-only object without its UUID.
 */
export function mapApiTable(raw: any, areaId?: string): RestaurantTable {
  return {
    id: raw.id,
    number: raw.number,
    displayName: raw.display_name || undefined,
    areaId: areaId,
    minCapacity: raw.min_capacity ?? 2,
    maxCapacity: raw.max_capacity ?? 4,
    shape: raw.shape ?? 'square',
    status: raw.status ?? 'available',
    tags: raw.tags ?? [],
    isActive: raw.is_active ?? true,
    hasQR: raw.has_qr ?? false,
    qrMode: raw.qr_mode ?? 'order_pay',
    qrRegeneratedAt: raw.qr_regenerated_at ? new Date(raw.qr_regenerated_at) : undefined,
    x: raw.floor_x ?? 50,
    y: raw.floor_y ?? 50,
    width: raw.floor_width ?? 10,
    height: raw.floor_height ?? 10,
  };
}

/**
 * Maps a raw backend dining-area record to the frontend DiningArea model.
 * Derives `tableIds` from the embedded `tables` array on the response.
 */
export function mapApiArea(raw: any): DiningArea {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description || undefined,
    isIndoor: raw.is_indoor ?? true,
    smokingAllowed: raw.smoking_zone ?? false,
    accessible: raw.accessible ?? false,
    defaultServerSection: raw.default_server_section || undefined,
    isActive: raw.is_active ?? true,
    tableIds: (raw.tables ?? []).map((t: any) => t.id),
  };
}
