import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { environment } from '../../../environments/environment';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenOrderService } from '../services/kitchen-order.service';
import { KitchenStockService } from '../services/kitchen-stock.service';
import { readFeed, readWaitingForStaff } from '../services/kitchen-wire';
import { BoardComponent } from './board.component';

const API = `${environment.apiUrl}/api/${environment.version}`;

/**
 * Step 2, FE-E — the kitchen board's "waiting for floor staff" chip (BE-G).
 *
 * The ACTIVE feed's envelope gains an OPTIONAL `waiting_for_staff`, a sibling of
 * `data`. Absent or malformed means "not given" (D07), never a guess, and an older
 * backend omits it — so against today's backend the board is unchanged. Driven
 * through the REAL ApiService and HttpClient, so the chip is a claim about the path
 * the deployed board takes.
 */
describe('readWaitingForStaff (kitchen-wire)', () => {
  it('reads a whole number of 0 or more', () => {
    expect(readWaitingForStaff({ waiting_for_staff: 0 })).toBe(0);
    expect(readWaitingForStaff({ waiting_for_staff: 1 })).toBe(1);
    expect(readWaitingForStaff({ waiting_for_staff: 12 })).toBe(12);
  });

  it('absent or malformed is "not given", never a guessed 0', () => {
    for (const value of [undefined, null, '2', -1, 1.5, Number.NaN, Infinity, true, [1], { n: 1 }]) {
      expect(readWaitingForStaff({ waiting_for_staff: value })).withContext(String(value)).toBeUndefined();
    }
    expect(readWaitingForStaff({})).toBeUndefined();
    expect(readWaitingForStaff(null)).toBeUndefined();
    expect(readWaitingForStaff('x')).toBeUndefined();
  });

  it('a malformed count does not refuse an otherwise readable feed', () => {
    const verdict = readFeed({ status: 200, data: [], waiting_for_staff: 'lots' });
    expect(verdict.kind).toBe('ok');
    expect((verdict as { waitingForStaff?: number }).waitingForStaff).toBeUndefined();
    expect('waitingForStaff' in verdict).toBeFalse();
  });

  it('a readable count rides the verdict', () => {
    const verdict = readFeed({ status: 200, data: [], waiting_for_staff: 3 });
    expect(verdict).toEqual(jasmine.objectContaining({ kind: 'ok', waitingForStaff: 3 }));
  });
});

describe('BoardComponent — the waiting-for-floor-staff chip', () => {
  let fixture: ComponentFixture<BoardComponent>;
  let http: HttpTestingController;
  let service: KitchenOrderService;

  beforeEach(async () => {
    spyOn(window, 'matchMedia').and.returnValue({
      matches: false, media: '', addEventListener: () => undefined, removeEventListener: () => undefined,
    } as unknown as MediaQueryList);
    await TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [
        ApiService,
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        {
          provide: AuthenticationService,
          useValue: {
            userValue: { profile: { id: 'u1', restaurant_roles: [{ restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] }] } },
            currentRestaurantRole: { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] },
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(KitchenOrderService);
    // The board's own poll is not under test here; the feed is driven explicitly.
    spyOn(service, 'startPolling');
    spyOn(service, 'stopPolling');
    // Nor is the sold-out panel's priming read.
    spyOn(TestBed.inject(KitchenStockService), 'loadItems');
    fixture = TestBed.createComponent(BoardComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
  });

  /** Apply one active-feed answer through the real HTTP path. */
  function activeFeed(extra: Record<string, unknown>): void {
    service.loadActive().subscribe();
    http.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/active/`))
      .flush({ status: 200, message: 'ok', data: { records: [] }, kitchen_protocol: 1, ...extra });
    fixture.detectChanges();
  }

  /**
   * The chip renders in TWO placements, one hidden by CSS at any width: the header
   * from 1280px (where it has free space) and the top of the board area below it
   * (where the header has none). Both read one getter, so both are asserted.
   */
  const chips = () =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="kitchen-waiting-chip"]')) as HTMLElement[];
  const chip = () => {
    const all = chips();
    if (all.length === 0) return null;
    expect(all.map(c => c.dataset['placement'])).toEqual(['header', 'board']);
    expect(new Set(all.map(c => c.textContent!.trim())).size).toBe(1);
    return all[0];
  };

  it('absent (today\'s backend): no chip, and the board is otherwise unchanged', () => {
    activeFeed({});
    expect(service.waitingForStaff()).toBeUndefined();
    expect(chip()).toBeNull();
    expect(service.canCommand()).toBeTrue();
    expect(service.feedUnreadable()).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('waiting for floor staff');
  });

  it('0: no chip', () => {
    activeFeed({ waiting_for_staff: 0 });
    expect(service.waitingForStaff()).toBe(0);
    expect(chip()).toBeNull();
  });

  it('1: singular chip, informational, with no action, in both placements', () => {
    activeFeed({ waiting_for_staff: 1 });
    expect(chip()!.textContent!.trim()).toBe('1 order waiting for floor staff');
    for (const c of chips()) {
      expect(c.getAttribute('role')).toBe('status');
      expect(c.querySelector('button, a')).toBeNull();
      expect(c.tagName).not.toBe('BUTTON');
      // A status tint (amber), never brand red.
      expect(c.className).toMatch(/bg-amber-/);
      expect(c.className).not.toMatch(/d-red|primary|destructive|bg-red/);
    }
    // The board-area placement never takes a tap from a card.
    expect(chips()[1].className).toContain('pointer-events-none');
  });

  it('several: plural chip', () => {
    activeFeed({ waiting_for_staff: 4 });
    expect(chip()!.textContent!.trim()).toBe('4 orders waiting for floor staff');
  });

  it('a malformed value is ignored: no chip, and the feed still applies', () => {
    for (const value of ['3', -2, 1.5, null, true]) {
      activeFeed({ waiting_for_staff: value });
      expect(service.waitingForStaff()).withContext(String(value)).toBeUndefined();
      expect(chip()).withContext(String(value)).toBeNull();
      expect(service.feedUnreadable()).toBeFalse();
    }
  });

  it('a later answer that says nothing clears the chip (silence is "not given")', () => {
    activeFeed({ waiting_for_staff: 2 });
    expect(chip()).not.toBeNull();
    activeFeed({});
    expect(chip()).toBeNull();
  });

  it('an older active answer landing late cannot replace a newer count', () => {
    service.loadActive().subscribe();
    service.loadActive().subscribe();
    const [older, newer] = http.match(r => r.url.startsWith(`${API}/kitchen/orders/active/`));
    newer.flush({ status: 200, data: { records: [] }, kitchen_protocol: 1, waiting_for_staff: 0 });
    older.flush({ status: 200, data: { records: [] }, kitchen_protocol: 1, waiting_for_staff: 5 });
    fixture.detectChanges();
    expect(service.waitingForStaff()).toBe(0);
    expect(chip()).toBeNull();
  });

  it('the completed feed does not carry the count', () => {
    activeFeed({ waiting_for_staff: 2 });
    service.loadCompleted().subscribe();
    http.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/completed/`))
      .flush({ status: 200, data: { records: [] }, kitchen_protocol: 1, waiting_for_staff: 0 });
    fixture.detectChanges();
    expect(chip()!.textContent!.trim()).toBe('2 orders waiting for floor staff');
  });
});
