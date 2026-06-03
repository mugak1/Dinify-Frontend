import { TestBed } from '@angular/core/testing';
import { fakeAsync, tick } from '@angular/core/testing';

import { KitchenOrderService } from './kitchen-order.service';

describe('KitchenOrderService', () => {
  let service: KitchenOrderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(KitchenOrderService);
  });

  /** Loads the mock dataset (400ms delay) into the service. */
  function load(): void {
    service.loadActive().subscribe();
    tick(400);
  }

  it('is created with no tickets and connected', () => {
    expect(service).toBeTruthy();
    expect(service.activeTickets().length).toBe(0);
    expect(service.connectionState()).toBe('connected');
  });

  it('loads the mock dataset behind the seam', fakeAsync(() => {
    load();
    expect(service.activeTickets().length).toBeGreaterThan(10);
  }));

  it('orders the oldest priority ticket first', fakeAsync(() => {
    load();
    const first = service.activeTickets()[0];
    expect(first.priority).toBe(true);
    // k-10 is the oldest priority ticket in the mock set (19 min).
    expect(first.id).toBe('k-10');
  }));

  describe('advanceStatus', () => {
    it('accepts a legal forward step', fakeAsync(() => {
      load();
      expect(service.advanceStatus('k-01', 'preparing')).toBe(true);
      expect(service.activeTickets().find(t => t.id === 'k-01')!.fulfilment_status).toBe('preparing');
    }));

    it('rejects an illegal skip and leaves state unchanged', fakeAsync(() => {
      load();
      expect(service.advanceStatus('k-01', 'ready')).toBe(false);
      expect(service.activeTickets().find(t => t.id === 'k-01')!.fulfilment_status).toBe('new');
    }));

    it('stamps served_at when advancing to served', fakeAsync(() => {
      load();
      // k-11 is 'ready' → served is the legal next step.
      expect(service.advanceStatus('k-11', 'served')).toBe(true);
      const t = service.activeTickets().find(x => x.id === 'k-11')!;
      expect(t.fulfilment_status).toBe('served');
      expect(t.served_at).not.toBeNull();
    }));
  });

  describe('recall', () => {
    it('recalls a served ticket within the window (clears served_at)', fakeAsync(() => {
      load();
      // k-14 was served 3 min ago — inside the 10-min window.
      expect(service.recall('k-14')).toBe(true);
      const t = service.activeTickets().find(x => x.id === 'k-14')!;
      expect(t.fulfilment_status).toBe('ready');
      expect(t.served_at).toBeNull();
    }));

    it('rejects recall of a served ticket beyond the window', fakeAsync(() => {
      load();
      // k-16 was served 14 min ago — past the 10-min window.
      expect(service.recall('k-16')).toBe(false);
      expect(service.activeTickets().find(x => x.id === 'k-16')!.fulfilment_status).toBe('served');
    }));

    it('recalls a ready ticket back to preparing at any time', fakeAsync(() => {
      load();
      expect(service.recall('k-11')).toBe(true);
      expect(service.activeTickets().find(x => x.id === 'k-11')!.fulfilment_status).toBe('preparing');
    }));
  });

  it('toggles priority', fakeAsync(() => {
    load();
    const before = service.activeTickets().find(t => t.id === 'k-01')!.priority;
    service.togglePriority('k-01');
    expect(service.activeTickets().find(t => t.id === 'k-01')!.priority).toBe(!before);
  }));

  describe('dev controls', () => {
    it('injects a brand-new ticket in "new" status', fakeAsync(() => {
      load();
      const before = service.activeTickets().length;
      const injected = service.injectNewTicket();
      expect(service.activeTickets().length).toBe(before + 1);
      expect(injected.fulfilment_status).toBe('new');
      expect(service.activeTickets().some(t => t.id === injected.id)).toBe(true);
    }));

    it('simulates connection states', () => {
      service.simulateConnectionState('reconnecting');
      expect(service.connectionState()).toBe('reconnecting');
      service.simulateConnectionState('offline');
      expect(service.connectionState()).toBe('offline');
    });
  });

  describe('pruneServed', () => {
    it('drops served tickets past the recall window only', fakeAsync(() => {
      load();
      const hadStale = service.activeTickets().some(t => t.id === 'k-16');
      expect(hadStale).toBe(true);
      service.pruneServed(Date.now());
      expect(service.activeTickets().some(t => t.id === 'k-16')).toBe(false); // 14 min → pruned
      expect(service.activeTickets().some(t => t.id === 'k-14')).toBe(true);  // 3 min → kept
    }));
  });
});
