import {
  DiningArea,
  RestaurantTable,
  Server,
  Reservation,
  WaitlistEntry,
  SeatedParty,
} from '../models/tables.models';

export const mockServers: Server[] = [
  { id: 'srv-1', name: 'Amy', initials: 'AM', section: 'A' },
  { id: 'srv-2', name: 'Brian', initials: 'BR', section: 'B' },
  { id: 'srv-3', name: 'Carol', initials: 'CR', section: 'C' },
];

export const mockAreas: DiningArea[] = [
  {
    id: 'area-1',
    name: 'Main Dining',
    description: 'Primary indoor dining area',
    isIndoor: true,
    smokingAllowed: false,
    accessible: true,
    defaultServerSection: 'A',
    isActive: true,
    tableIds: ['t-1', 't-2', 't-3', 't-4', 't-5', 't-6'],
  },
  {
    id: 'area-2',
    name: 'Balcony',
    description: 'Outdoor seating with city view',
    isIndoor: false,
    smokingAllowed: true,
    accessible: false,
    defaultServerSection: 'B',
    isActive: true,
    tableIds: ['t-7', 't-8', 't-9', 't-10'],
  },
  {
    id: 'area-3',
    name: 'Terrace',
    description: 'Garden terrace seating',
    isIndoor: false,
    smokingAllowed: true,
    accessible: true,
    defaultServerSection: 'B',
    isActive: true,
    tableIds: ['t-11', 't-12', 't-13', 't-14'],
  },
  {
    id: 'area-4',
    name: 'Bar',
    description: 'Bar counter seating',
    isIndoor: true,
    smokingAllowed: false,
    accessible: true,
    defaultServerSection: 'C',
    isActive: true,
    tableIds: ['t-15', 't-16', 't-17', 't-18'],
  },
];

export const mockTables: RestaurantTable[] = [
  // Main Dining (6 tables)
  { id: 't-1', number: 1, areaId: 'area-1', minCapacity: 2, maxCapacity: 2, shape: 'round', status: 'available', tags: ['window'], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-1', x: 8, y: 18, width: 10, height: 10 },
  { id: 't-2', number: 2, areaId: 'area-1', minCapacity: 2, maxCapacity: 4, shape: 'square', status: 'seated', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-1', x: 23, y: 18, width: 12, height: 12 },
  { id: 't-3', number: 3, areaId: 'area-1', minCapacity: 4, maxCapacity: 6, shape: 'rectangle', status: 'bill_requested', tags: ['booth'], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-1', x: 40, y: 18, width: 16, height: 10 },
  { id: 't-4', number: 4, areaId: 'area-1', minCapacity: 2, maxCapacity: 4, shape: 'square', status: 'dirty', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-1', x: 8, y: 38, width: 12, height: 12 },
  { id: 't-5', number: 5, areaId: 'area-1', minCapacity: 4, maxCapacity: 4, shape: 'square', status: 'seated', tags: ['vip'], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-1', x: 23, y: 38, width: 12, height: 12 },
  { id: 't-6', number: 6, areaId: 'area-1', minCapacity: 6, maxCapacity: 8, shape: 'rectangle', status: 'available', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-1', x: 40, y: 38, width: 18, height: 12 },

  // Balcony (4 tables)
  { id: 't-7', number: 7, areaId: 'area-2', minCapacity: 2, maxCapacity: 2, shape: 'round', status: 'seated', tags: ['window'], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 63, y: 14, width: 10, height: 10 },
  { id: 't-8', number: 8, areaId: 'area-2', minCapacity: 2, maxCapacity: 4, shape: 'square', status: 'available', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 78, y: 14, width: 12, height: 12 },
  { id: 't-9', number: 9, areaId: 'area-2', minCapacity: 4, maxCapacity: 4, shape: 'square', status: 'seated', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 63, y: 32, width: 12, height: 12 },
  { id: 't-10', number: 10, areaId: 'area-2', minCapacity: 2, maxCapacity: 2, shape: 'round', status: 'out_of_service', tags: [], isActive: false, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 80, y: 32, width: 10, height: 10 },

  // Terrace (4 tables)
  { id: 't-11', number: 11, areaId: 'area-3', minCapacity: 4, maxCapacity: 6, shape: 'rectangle', status: 'available', tags: ['accessible'], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 8, y: 60, width: 16, height: 10 },
  { id: 't-12', number: 12, areaId: 'area-3', minCapacity: 2, maxCapacity: 4, shape: 'square', status: 'seated', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 28, y: 60, width: 12, height: 12 },
  { id: 't-13', number: 13, areaId: 'area-3', minCapacity: 4, maxCapacity: 4, shape: 'square', status: 'available', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-2', x: 8, y: 78, width: 12, height: 12 },
  { id: 't-14', number: 14, areaId: 'area-3', minCapacity: 2, maxCapacity: 2, shape: 'round', status: 'dirty', tags: [], isActive: true, hasQR: false, serverId: 'srv-2', x: 28, y: 78, width: 10, height: 10 },

  // Bar (4 tables)
  { id: 't-15', number: 15, displayName: 'Bar 1', areaId: 'area-4', minCapacity: 1, maxCapacity: 2, shape: 'bar', status: 'seated', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-3', x: 58, y: 56, width: 8, height: 12 },
  { id: 't-16', number: 16, displayName: 'Bar 2', areaId: 'area-4', minCapacity: 1, maxCapacity: 2, shape: 'bar', status: 'available', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-3', x: 68, y: 56, width: 8, height: 12 },
  { id: 't-17', number: 17, displayName: 'Bar 3', areaId: 'area-4', minCapacity: 1, maxCapacity: 2, shape: 'bar', status: 'seated', tags: [], isActive: true, hasQR: true, qrMode: 'order_pay', serverId: 'srv-3', x: 78, y: 56, width: 8, height: 12 },
  { id: 't-18', number: 18, displayName: 'Bar 4', areaId: 'area-4', minCapacity: 1, maxCapacity: 2, shape: 'bar', status: 'available', tags: [], isActive: true, hasQR: true, qrMode: 'menu_only', serverId: 'srv-3', x: 88, y: 56, width: 8, height: 12 },
];

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

export const mockReservations: Reservation[] = [
  {
    id: 'res-1',
    guest: { name: 'Akampa M.', phone: '+256 700 123 456' },
    dateTime: new Date(today.getTime() + 19.5 * 60 * 60 * 1000), // 19:30
    partySize: 4,
    status: 'confirmed',
    areaPreference: 'Balcony',
    tags: { birthday: true },
    tableId: 't-8',
  },
  {
    id: 'res-2',
    guest: { name: 'Namugga S.', phone: '+256 701 234 567' },
    dateTime: new Date(today.getTime() + 19 * 60 * 60 * 1000), // 19:00
    partySize: 2,
    status: 'arrived',
    tags: { vip: true },
  },
  {
    id: 'res-3',
    guest: { name: 'Ochieng P.', phone: '+256 702 345 678' },
    dateTime: new Date(today.getTime() + 18.5 * 60 * 60 * 1000), // 18:30
    partySize: 6,
    status: 'late',
    notes: 'Anniversary dinner',
    tags: { anniversary: true },
  },
  {
    id: 'res-4',
    guest: { name: 'Kizza J.' },
    dateTime: new Date(today.getTime() + 20 * 60 * 60 * 1000), // 20:00
    partySize: 3,
    status: 'confirmed',
    areaPreference: 'Main Dining',
    tags: { allergy: true },
    notes: 'Nut allergy',
  },
  {
    id: 'res-5',
    guest: { name: 'Birungi R.' },
    dateTime: new Date(today.getTime() + 20.5 * 60 * 60 * 1000), // 20:30
    partySize: 2,
    status: 'confirmed',
    tags: { nonSmoking: true },
  },
  {
    id: 'res-6',
    guest: { name: 'Mugisha D.' },
    dateTime: new Date(today.getTime() + 21 * 60 * 60 * 1000), // 21:00
    partySize: 8,
    status: 'confirmed',
    areaPreference: 'Terrace',
    tags: {},
  },
  {
    id: 'res-7',
    guest: { name: 'Auma F.' },
    dateTime: new Date(today.getTime() + 19.75 * 60 * 60 * 1000), // 19:45
    partySize: 4,
    status: 'confirmed',
    tags: { vip: true, birthday: true },
  },
  {
    id: 'res-8',
    guest: { name: 'Tumwine E.' },
    dateTime: new Date(today.getTime() + 18 * 60 * 60 * 1000), // 18:00
    partySize: 2,
    status: 'no_show',
    tags: {},
  },
];

export const mockWaitlist: WaitlistEntry[] = [
  {
    id: 'wait-1',
    guest: { name: 'Okello B.', phone: '+256 703 456 789' },
    partySize: 3,
    quotedWaitMinutes: { min: 20, max: 30 },
    addedAt: new Date(now.getTime() - 15 * 60 * 1000), // 15 min ago
    tags: {},
  },
  {
    id: 'wait-2',
    guest: { name: 'Nakabugo L.' },
    partySize: 2,
    quotedWaitMinutes: { min: 10, max: 20 },
    addedAt: new Date(now.getTime() - 5 * 60 * 1000), // 5 min ago
    tags: { vip: true },
  },
  {
    id: 'wait-3',
    guest: { name: 'Ssempijja K.' },
    partySize: 5,
    quotedWaitMinutes: { min: 30, max: 45 },
    addedAt: new Date(now.getTime() - 25 * 60 * 1000), // 25 min ago
    tags: { birthday: true },
  },
];

export const mockSeatedParties: SeatedParty[] = [
  {
    id: 'seated-1',
    tableId: 't-2',
    guest: { name: 'Wasswa T.' },
    partySize: 3,
    adults: 2,
    children: 1,
    seatedAt: new Date(now.getTime() - 45 * 60 * 1000),
    serverId: 'srv-1',
    currentCheck: 145000,
    isPaid: false,
    orderItems: [
      { id: 'item-1', name: 'Beef Burger', quantity: 3, status: 'in_kitchen' },
      { id: 'item-2', name: 'Soda', quantity: 2, status: 'served' },
    ],
  },
  {
    id: 'seated-2',
    tableId: 't-3',
    guest: { name: 'Nalubega M.' },
    partySize: 4,
    adults: 4,
    children: 0,
    seatedAt: new Date(now.getTime() - 62 * 60 * 1000),
    serverId: 'srv-1',
    currentCheck: 280000,
    isPaid: false,
    orderItems: [
      { id: 'item-3', name: 'Grilled Fish', quantity: 2, status: 'served' },
      { id: 'item-4', name: 'Rolex', quantity: 2, status: 'served' },
      { id: 'item-5', name: 'Wine', quantity: 1, status: 'served' },
    ],
  },
  {
    id: 'seated-3',
    tableId: 't-5',
    guest: { name: 'Kato J.' },
    partySize: 4,
    adults: 3,
    children: 1,
    seatedAt: new Date(now.getTime() - 38 * 60 * 1000),
    serverId: 'srv-1',
    currentCheck: 195000,
    isPaid: false,
    orderItems: [
      { id: 'item-6', name: 'Chicken Wings', quantity: 2, status: 'ready' },
      { id: 'item-7', name: 'Fries', quantity: 2, status: 'served' },
    ],
  },
  {
    id: 'seated-4',
    tableId: 't-7',
    guest: { name: 'Musoke P.' },
    partySize: 2,
    adults: 2,
    children: 0,
    seatedAt: new Date(now.getTime() - 28 * 60 * 1000),
    serverId: 'srv-2',
    currentCheck: 85000,
    isPaid: false,
    orderItems: [
      { id: 'item-8', name: 'Pizza', quantity: 1, status: 'in_kitchen' },
    ],
  },
  {
    id: 'seated-5',
    tableId: 't-9',
    guest: { name: 'Achieng S.' },
    partySize: 4,
    adults: 4,
    children: 0,
    seatedAt: new Date(now.getTime() - 55 * 60 * 1000),
    serverId: 'srv-2',
    currentCheck: 320000,
    isPaid: false,
    orderItems: [
      { id: 'item-9', name: 'Steak', quantity: 2, status: 'served' },
      { id: 'item-10', name: 'Pasta', quantity: 2, status: 'served' },
    ],
  },
  {
    id: 'seated-6',
    tableId: 't-12',
    guest: { name: 'Byaruhanga R.' },
    partySize: 3,
    adults: 2,
    children: 1,
    seatedAt: new Date(now.getTime() - 42 * 60 * 1000),
    serverId: 'srv-2',
    currentCheck: 125000,
    isPaid: false,
    orderItems: [
      { id: 'item-11', name: 'Matoke', quantity: 2, status: 'served' },
      { id: 'item-12', name: 'Juice', quantity: 3, status: 'served' },
    ],
  },
  {
    id: 'seated-7',
    tableId: 't-15',
    partySize: 1,
    adults: 1,
    children: 0,
    seatedAt: new Date(now.getTime() - 20 * 60 * 1000),
    serverId: 'srv-3',
    currentCheck: 45000,
    isPaid: false,
    orderItems: [
      { id: 'item-13', name: 'Beer', quantity: 2, status: 'served' },
    ],
  },
  {
    id: 'seated-8',
    tableId: 't-17',
    partySize: 2,
    adults: 2,
    children: 0,
    seatedAt: new Date(now.getTime() - 15 * 60 * 1000),
    serverId: 'srv-3',
    currentCheck: 68000,
    isPaid: false,
    orderItems: [
      { id: 'item-14', name: 'Cocktail', quantity: 2, status: 'served' },
      { id: 'item-15', name: 'Samosas', quantity: 1, status: 'ready' },
    ],
  },
];

// ── Helper functions ──────────────────────────────────────

export const getTableSeatedTime = (tableId: string): number | null => {
  const party = mockSeatedParties.find(p => p.tableId === tableId);
  if (!party) return null;
  return Math.floor((Date.now() - party.seatedAt.getTime()) / (60 * 1000));
};

export const getTableParty = (tableId: string): SeatedParty | undefined => {
  return mockSeatedParties.find(p => p.tableId === tableId);
};

export const getServerById = (serverId: string): Server | undefined => {
  return mockServers.find(s => s.id === serverId);
};

export const getAreaById = (areaId: string): DiningArea | undefined => {
  return mockAreas.find(a => a.id === areaId);
};
