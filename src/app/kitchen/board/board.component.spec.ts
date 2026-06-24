import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
} from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { getMockTickets } from '../mock/kitchen-mock-data';
import { KitchenOrderService } from '../services/kitchen-order.service';
import { BoardComponent } from './board.component';

/**
 * Controllable `window.matchMedia` stub: lets a test seed the initial match and
 * later fire a `change` event to flip the board between wide and narrow layouts.
 */
function installMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: '(max-width: 768px)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatch(next: boolean) {
      this.matches = next;
      listeners.forEach(cb => cb({ matches: next } as MediaQueryListEvent));
    },
  };
  spyOn(window, 'matchMedia').and.returnValue(mql as unknown as MediaQueryList);
  return mql;
}

describe('BoardComponent', () => {
  let fixture: ComponentFixture<BoardComponent>;
  let component: BoardComponent;

  /** Two served tickets for the Completed feed — ids distinct from the active set. */
  function completedRecords() {
    const base = {
      order_number: 500,
      table_label: 'Table Z',
      order_source: 'diner_self_service' as const,
      fulfilment_status: 'served' as const,
      priority: false,
      created_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      items: [],
    };
    return [
      { ...base, id: 'done-1', served_at: new Date(Date.now() - 2 * 60_000).toISOString() },
      { ...base, id: 'done-2', served_at: new Date(Date.now() - 6 * 60_000).toISOString() },
    ];
  }

  let apiStub: { get: jasmine.Spy; postPatch: jasmine.Spy };

  beforeEach(async () => {
    apiStub = {
      get: jasmine.createSpy('get').and.callFake((_: any, url: string) =>
        url === 'kitchen/orders/completed/'
          ? of({ status: 200, data: { records: completedRecords() } })
          : of({ status: 200, data: { records: getMockTickets() } })),
      postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
    };
    const authStub = {
      userValue: {
        profile: { restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] },
      },
    };

    await TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: AuthenticationService, useValue: authStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardComponent);
    component = fixture.componentInstance;
  });

  it('creates and renders the chrome', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Kitchen');
    expect(text).toContain('Enable sound');
    fixture.destroy();
  });

  it('renders the active ticket set after the first poll', fakeAsync(() => {
    fixture.detectChanges(); // ngOnInit → startPolling() → first poll (sync stub)
    fixture.detectChanges(); // render the cards from the populated signal

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('app-kitchen-ticket-card');
    expect(cards.length).toBeGreaterThan(0);

    fixture.destroy();       // ngOnDestroy → stopPolling()
    discardPeriodicTasks();  // clear the 1s age ticker
  }));

  it('flips isNarrow when the media query change event fires', () => {
    const mql = installMatchMedia(false);
    fixture.detectChanges(); // ngOnInit seeds isNarrow from matchMedia().matches
    expect(component.isNarrow()).toBeFalse();

    mql.dispatch(true);      // viewport crosses below 768px
    fixture.detectChanges();
    expect(component.isNarrow()).toBeTrue();

    fixture.destroy();
  });

  it('renders the vertical scroll list (not the pager) in narrow mode', () => {
    installMatchMedia(true);
    fixture.detectChanges(); // ngOnInit → narrow; first poll populates tickets
    fixture.detectChanges(); // render the cards

    const el = fixture.nativeElement as HTMLElement;
    expect(component.isNarrow()).toBeTrue();
    expect(el.querySelector('[data-testid="kitchen-narrow-list"]')).toBeTruthy();
    expect(el.querySelector('.snap-x')).toBeNull(); // no pager element
    expect(el.querySelectorAll('app-kitchen-ticket-card').length).toBeGreaterThan(0);

    fixture.destroy();
  });

  it('renders the pager (not the vertical list) in wide mode', () => {
    installMatchMedia(false);
    fixture.detectChanges();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(component.isNarrow()).toBeFalse();
    expect(el.querySelector('.snap-x')).toBeTruthy(); // pager unchanged
    expect(el.querySelector('[data-testid="kitchen-narrow-list"]')).toBeNull();
    expect(el.querySelectorAll('app-kitchen-ticket-card').length).toBeGreaterThan(0);

    fixture.destroy();
  });

  describe('responsive landscape grid (cols ↔ pageSize coupling)', () => {
    it('locks page capacity to cols × 2', () => {
      component.cols.set(3);
      expect(component.pageSize()).toBe(6);
      component.cols.set(4);
      expect(component.pageSize()).toBe(8);
      component.cols.set(5);
      expect(component.pageSize()).toBe(10);

      fixture.destroy();
    });

    it('chunks tickets into pages of pageSize — no empty trailing page, no hidden tickets', () => {
      installMatchMedia(false); // wide pager
      fixture.detectChanges();  // ngOnInit → first poll populates tickets
      fixture.detectChanges();

      component.cols.set(4);    // pageSize → 8, independent of the test viewport
      const size = component.pageSize();
      const pages = component.pages();
      const total = component.tickets().length;
      expect(total).toBeGreaterThan(0); // sanity: mock populated

      // Page count is driven by pageSize (cols × 2), not a hard-coded 8.
      expect(pages.length).toBe(Math.ceil(total / size));
      pages.forEach((page, i) => {
        expect(page.length).toBeLessThanOrEqual(size);            // never overflows capacity
        if (i < pages.length - 1) expect(page.length).toBe(size); // only the last page may be short
      });
      expect(pages.reduce((n, p) => n + p.length, 0)).toBe(total); // no hidden tickets

      fixture.destroy();
    });
  });

  describe('Active | Completed view toggle', () => {
    it('switches to the completed feed and back to active', fakeAsync(() => {
      installMatchMedia(false); // wide pager
      fixture.detectChanges(); // ngOnInit → first active poll (sync stub)
      fixture.detectChanges();

      expect(component.viewMode()).toBe('active');
      expect(component.tickets().some(t => t.id === 'k-01')).toBeTrue();

      component.setView('completed');
      fixture.detectChanges();

      expect(component.viewMode()).toBe('completed');
      expect(apiStub.get).toHaveBeenCalledWith(
        null, 'kitchen/orders/completed/', { restaurant: 'r1' });
      // Grid now sources completedTickets, newest-first; active ids gone.
      expect(component.tickets().map(t => t.id)).toEqual(['done-1', 'done-2']);
      expect(component.tickets().some(t => t.id === 'k-01')).toBeFalse();
      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('app-kitchen-ticket-card');
      expect(cards.length).toBe(2);

      component.setView('active');
      fixture.detectChanges();

      expect(component.viewMode()).toBe('active');
      expect(component.tickets().some(t => t.id === 'k-01')).toBeTrue();

      fixture.destroy();
      discardPeriodicTasks(); // 1s ticker + completed-refresh interval
    }));

    it('hides the active-only jump controls in completed mode', fakeAsync(() => {
      installMatchMedia(false);
      fixture.detectChanges();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const hasOldest = () =>
        Array.from(el.querySelectorAll('button')).some(b => (b.textContent ?? '').trim() === 'Oldest');
      expect(hasOldest()).toBeTrue();

      component.setView('completed');
      fixture.detectChanges();
      expect(hasOldest()).toBeFalse();

      fixture.destroy();
      discardPeriodicTasks();
    }));
  });

  describe('connection escalation banner', () => {
    // Drives the real (root-provided) service signal via its test seam. Order matters:
    // detectChanges() first lets ngOnInit's first (synchronous) poll settle to 'connected',
    // THEN we force the state — otherwise that poll would clobber a pre-set value. Later polls
    // are on setTimeout, so nothing fires inside the synchronous test body to clobber it back.
    it('shows no banner when connected — the header dot suffices', () => {
      const service = TestBed.inject(KitchenOrderService);
      fixture.detectChanges();
      service.simulateConnectionState('connected');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('[data-testid="kitchen-offline-banner"]')).toBeNull();
      expect(el.querySelector('[data-testid="kitchen-reconnecting-banner"]')).toBeNull();

      fixture.destroy();
    });

    it('renders the loud offline bar when offline', () => {
      const service = TestBed.inject(KitchenOrderService);
      fixture.detectChanges();
      service.simulateConnectionState('offline');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const banner = el.querySelector('[data-testid="kitchen-offline-banner"]');
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain('missing new orders');
      expect(el.querySelector('[data-testid="kitchen-reconnecting-banner"]')).toBeNull();

      fixture.destroy();
    });

    it('renders the subtler amber strip when reconnecting', () => {
      const service = TestBed.inject(KitchenOrderService);
      fixture.detectChanges();
      service.simulateConnectionState('reconnecting');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const banner = el.querySelector('[data-testid="kitchen-reconnecting-banner"]');
      expect(banner).toBeTruthy();
      expect(banner!.textContent).toContain('Reconnecting');
      expect(el.querySelector('[data-testid="kitchen-offline-banner"]')).toBeNull();

      fixture.destroy();
    });
  });
});
