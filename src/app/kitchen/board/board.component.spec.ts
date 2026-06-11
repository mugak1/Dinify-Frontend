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

  beforeEach(async () => {
    const apiStub = {
      get: jasmine.createSpy('get').and.callFake(() =>
        of({ status: 200, data: { records: getMockTickets() } })),
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
