import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { NEVER, Subject, map, switchMap, throwError, timer } from 'rxjs';
import { TablesServiceViewComponent } from './tables-service-view.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { TablesService } from '../../services/tables.service';
import { FloorMockBackend } from '../../services/floor-mock-backend';
import { FLOOR_DEV_MODE } from '../../services/floor-view-gate';
import { FloorService } from '../../services/floor.service';
import { FLOOR_PAGE_VISIBILITY } from '../../services/floor-page-visibility';
import { MOCK_FLOOR_IDS as IDS } from '../../data/floor-mock-data';
import { RoundCommand, RoundRefusalReason } from '../../models/floor.models';
import { ORDER_GONE_MESSAGE, refusalMessage, unknownAnswerMessage } from '../../utils/floor-presentation';
import { PAYMENT_CLAIM, RED_CLASS } from '../../utils/floor-claims.testing';

/**
 * The floor view (Step 2) end to end: the real component tree, the real FloorService
 * and the mock backend answering in floor contract v1 (as BE-D shipped it). Only the
 * toast, the signed-in restaurant, page visibility and the (unused) TablesService are
 * stood in for. The mock is turned on here for the run (development build), exactly
 * as a local preview would; the live HTTP path is pinned in `floor.service.spec.ts`.
 */
describe('TablesServiceViewComponent — floor view (Step 2)', () => {
  let fixture: ComponentFixture<TablesServiceViewComponent>;
  let backend: FloorMockBackend;
  let toast: jasmine.SpyObj<ToastService>;
  let tablesService: jasmine.SpyObj<TablesService>;
  const pollMs = TablesServiceViewComponent.POLL_MS;
  const backoffMs = TablesServiceViewComponent.BACKOFF_MS;
  /** Page visibility, driven by the spec. */
  let pageHidden = false;
  let visibilityChanges: Subject<void>;
  function setHidden(hidden: boolean): void {
    pageHidden = hidden;
    visibilityChanges.next();
  }

  /** Every control a Step 2 drawer may show. Anything else is a hidden control leaking back. */
  const ALLOWED_DRAWER_BUTTONS = new Set([
    'Close', 'Confirm', 'Decline', 'Mark dirty', 'Mark available', 'Out of service', 'Try again',
  ]);
  /** The parked controls, by any name they have carried. */
  const PARKED_CONTROL = /walk-in|seat |mark paid|paid|off-system|print|bill\b|waitlist|change server|server|note|merge|split|transfer|reservation|full order/i;

  beforeEach(() => {
    FloorService.USE_MOCK_DATA = true;
    TablesServiceViewComponent.POLL_MS = 10 * 60_000; // keep background polls out of the way
    TablesServiceViewComponent.BACKOFF_MS = [20 * 60_000, 40 * 60_000];
    pageHidden = false;
    visibilityChanges = new Subject<void>();
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warning', 'clear']);
    tablesService = jasmine.createSpyObj<TablesService>('TablesService', ['updateTableStatus', 'updateTable', 'seatWalkIn']);
    TestBed.configureTestingModule({
      imports: [TablesServiceViewComponent],
      providers: [
        { provide: FLOOR_DEV_MODE, useValue: true },
        { provide: ToastService, useValue: toast },
        { provide: TablesService, useValue: tablesService },
        { provide: AuthenticationService, useValue: { currentRestaurantRole: { restaurant_id: 'r-1' } } },
        {
          provide: FLOOR_PAGE_VISIBILITY,
          useFactory: () => ({ hidden: () => pageHidden, changes: visibilityChanges.asObservable() }),
        },
      ],
    });
    backend = TestBed.inject(FloorMockBackend);
  });

  afterEach(() => {
    FloorService.USE_MOCK_DATA = false;
    TablesServiceViewComponent.POLL_MS = pollMs;
    TablesServiceViewComponent.BACKOFF_MS = backoffMs;
  });

  // ── helpers ────────────────────────────────────────────────────

  const root = () => fixture.nativeElement as HTMLElement;
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const cards = () => Array.from(root().querySelectorAll<HTMLElement>('[data-testid="floor-table"]'));
  const card = (id: string) => root().querySelector<HTMLElement>(`[data-testid="floor-table"][data-table-id="${id}"]`)!;
  const drawer = () => root().querySelector<HTMLElement>('[data-testid="table-drawer"]');
  const drawerRound = (orderId: string) =>
    root().querySelector<HTMLElement>(`[data-testid="drawer-round"][data-order-id="${orderId}"]`);
  const btn = (scope: ParentNode, testid: string) => scope.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;
  const notices = () => Array.from(root().querySelectorAll('[data-testid="round-notice"]')).map(text);

  function settle(): void {
    for (let i = 0; i < 3; i++) {
      tick(1_000);
      fixture.detectChanges();
    }
  }

  function boot(): void {
    fixture = TestBed.createComponent(TablesServiceViewComponent);
    fixture.detectChanges();
    settle();
  }

  function finish(): void {
    fixture.destroy();
    discardPeriodicTasks();
    flush();
  }

  function open(tableId: string): void {
    card(tableId).click();
    fixture.detectChanges();
    settle();
  }

  function decline(orderId: string): void {
    btn(drawerRound(orderId)!, 'decline-round').click();
    fixture.detectChanges();
    btn(root(), 'decline-confirm').click();
    fixture.detectChanges();
  }

  function allToasts(): string[] {
    return (['success', 'error', 'info', 'warning'] as const).flatMap(m =>
      toast[m].calls.allArgs().map(a => String(a[0])),
    );
  }

  // ── what the floor shows ───────────────────────────────────────

  describe('every state the mock carries', () => {
    it('shows the server’s "N waiting" count', fakeAsync(() => {
      boot();
      expect(text(root().querySelector('[data-testid="waiting-count"]'))).toBe('4 waiting');
      finish();
    }));

    it('a fresh held round reads "Waiting for staff" with its age', fakeAsync(() => {
      boot();
      expect(text(card(IDS.freshHeldTable).querySelector('[data-testid="round-chip"]'))).toBe('Waiting for staff');
      expect(text(card(IDS.freshHeldTable).querySelector('[data-testid="held-age"]'))).toBe('4 min');
      finish();
    }));

    it('a stale held round reads "Waiting over 15 min" (the server’s flag) with its age', fakeAsync(() => {
      boot();
      expect(text(card(IDS.staleHeldTable).querySelector('[data-testid="round-chip"]'))).toBe('Waiting over 15 min');
      expect(text(card(IDS.staleHeldTable).querySelector('[data-testid="held-age"]'))).toBe('22 min');
      finish();
    }));

    it('released rounds read "Sent to kitchen" with the kitchen’s progress', fakeAsync(() => {
      boot();
      const chips = Array.from(card(IDS.releasedTable).querySelectorAll('[data-testid="round-chip"]')).map(text);
      expect(chips).toEqual(['Sent to kitchen', 'Sent to kitchen']);
      expect(text(card(IDS.releasedTable))).toContain('Ready');
      expect(text(card(IDS.releasedTable))).toContain('Preparing');
      finish();
    }));

    it('an order with no visit is shown on a table whose status is still Available', fakeAsync(() => {
      boot();
      const c = card(IDS.noVisitTable);
      expect(text(c.querySelector('[data-testid="table-status"]'))).toBe('Available');
      expect(text(c.querySelector('[data-testid="round-chip"]'))).toBe('Sent to kitchen');
      expect(text(c.querySelector('[data-testid="no-visit"]'))).toBe('No visit recorded');
      finish();
    }));

    it('free, dirty and out-of-service tables', fakeAsync(() => {
      boot();
      expect(text(card(IDS.freeTable))).toContain('No orders');
      expect(text(card(IDS.dirtyTable).querySelector('[data-testid="table-status"]'))).toBe('Dirty');
      expect(text(card(IDS.outOfServiceTable).querySelector('[data-testid="table-status"]'))).toBe('Out of service');
      finish();
    }));

    it('a held round that cannot be made shows the destructive badge and disables Confirm', fakeAsync(() => {
      boot();
      open(IDS.cannotBeMadeTable);
      const round = drawerRound(IDS.cannotBeMadeRound)!;
      const badge = round.querySelector('[data-testid="cannot-be-made"]')!;
      expect(text(badge)).toBe('Cannot be made — Chicken luwombo');
      expect(badge.className).toContain('bg-destructive');
      expect(btn(round, 'confirm-round').disabled).toBeTrue();
      expect(btn(round, 'decline-round').disabled).toBeFalse();
      finish();
    }));

    it('the drawer lists a round’s items, extras, modifiers and note, and its value "to pay"', fakeAsync(() => {
      boot();
      open(IDS.freshHeldTable);
      const round = drawerRound(IDS.freshHeldRound)!;
      const items = Array.from(round.querySelectorAll('[data-testid="round-item"]')).map(li =>
        Array.from(li.children).map(text),
      );
      expect(items).toEqual([
        ['2× Rolex', '+ 1× Avocado', 'No onion'],
        ['1× African tea', '“Less sugar”'],
      ]);
      expect(text(round.querySelector('[data-testid="round-value"]'))).toBe('UGX 17,000 to pay');
      expect(text(round.querySelector('[data-testid="round-chip"]'))).toBe('Waiting for staff');
      finish();
    }));

    it('a bill reads "Payment unknown", with or without a visit', fakeAsync(() => {
      boot();
      open(IDS.releasedTable);
      expect(text(drawer()!.querySelector('[data-testid="drawer-payment"]'))).toBe('Payment unknown');
      open(IDS.noVisitTable);
      expect(text(drawer()!.querySelector('[data-testid="drawer-no-visit"]'))).toBe('No visit recorded for these orders');
      expect(text(drawer()!.querySelector('[data-testid="drawer-payment"]'))).toBe('Payment unknown');
      finish();
    }));
  });

  describe('tables needing staff are listed first', () => {
    it('in the floor’s order: waiting tables, then the rest by number', fakeAsync(() => {
      boot();
      const order = cards().map(c => text(c.querySelector('.text-card-title')));
      expect(order).toEqual(['T2', 'T3', 'T4', 'T9', 'T1', 'T5', 'T6', 'T7', 'T8', 'T10']);
      const groups = Array.from(root().querySelectorAll('section h2')).map(text);
      expect(groups).toEqual(['Needs staff', 'Other tables']);
      finish();
    }));

    it('even when the server sends them last, keeping its order inside each group', fakeAsync(() => {
      const real = backend.getFloor.bind(backend);
      spyOn(backend, 'getFloor').and.callFake(r =>
        real(r).pipe(map((env: any) => ({ ...env, data: { ...env.data, tables: [...env.data.tables].reverse() } }))),
      );
      boot();
      const order = cards().map(c => text(c.querySelector('.text-card-title')));
      expect(order).toEqual(['T9', 'T4', 'T3', 'T2', 'T10', 'T8', 'T7', 'T6', 'T5', 'T1']);
      finish();
    }));

    it('search and the status filter keep that order', fakeAsync(() => {
      boot();
      fixture.componentInstance.statusFilter = ['seated'];
      fixture.detectChanges();
      expect(cards().map(c => text(c.querySelector('.text-card-title')))).toEqual(['T2', 'T3', 'T4', 'T9', 'T5']);
      fixture.componentInstance.statusFilter = [];
      fixture.componentInstance.search = '1';
      fixture.detectChanges();
      expect(cards().map(c => text(c.querySelector('.text-card-title')))).toEqual(['T1', 'T10']);
      finish();
    }));
  });

  // ── colour roles ───────────────────────────────────────────────

  it('NEVER RED FOR STATUS: no card or status chip carries a red class', fakeAsync(() => {
    boot();
    const statusEls = [
      ...cards(),
      ...Array.from(root().querySelectorAll('[data-testid="round-chip"], [data-testid="table-status"], [data-testid="waiting-count"]')),
    ];
    expect(statusEls.length).toBeGreaterThan(20);
    for (const el of statusEls) expect(RED_CLASS.test(el.className)).withContext(el.className).toBeFalse();
    for (const id of Object.values(IDS).filter(id => cards().some(c => c.dataset['tableId'] === id))) {
      open(id);
      for (const el of Array.from(drawer()!.querySelectorAll('[data-testid="round-chip"], [data-testid="drawer-table-status"]'))) {
        expect(RED_CLASS.test(el.className)).withContext(`${id}: ${el.className}`).toBeFalse();
      }
    }
    finish();
  }));

  it('Confirm is the only brand-red control in a drawer', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    const red = Array.from(drawer()!.querySelectorAll<HTMLElement>('button')).filter(b =>
      /(?:^|\s)bg-primary(?:\s|$)/.test(b.className),
    );
    expect(red.map(text)).toEqual(['Confirm']);
    finish();
  }));

  // ── hidden controls ────────────────────────────────────────────

  it('HIDDEN: no reservations pane, reservation modal or transfer modal is rendered', fakeAsync(() => {
    boot();
    for (const sel of ['app-reservations-pane', 'app-new-reservation-modal', 'app-transfer-table-modal']) {
      expect(root().querySelector(sel)).withContext(sel).toBeNull();
    }
    finish();
  }));

  it('HIDDEN: on every table, the drawer offers only Step 2 controls', fakeAsync(() => {
    const opened = spyOn(window, 'open');
    boot();
    for (const c of cards()) {
      open(c.dataset['tableId']!);
      const labels = Array.from(drawer()!.querySelectorAll('button')).map(b => text(b) || b.getAttribute('aria-label') || '');
      for (const label of labels) {
        expect(ALLOWED_DRAWER_BUTTONS.has(label)).withContext(`${c.dataset['tableId']}: "${label}"`).toBeTrue();
        expect(PARKED_CONTROL.test(label)).withContext(label).toBeFalse();
      }
      for (const el of Array.from(drawer()!.querySelectorAll('[title], [aria-label]'))) {
        const name = `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
        expect(PARKED_CONTROL.test(name)).withContext(name).toBeFalse();
      }
    }
    expect(opened).not.toHaveBeenCalled();
    finish();
  }));

  it('HIDDEN: the toolbar has a search and a status filter, and no area, shift, server or size control', fakeAsync(() => {
    boot();
    const toolbar = root().querySelector('app-service-toolbar')!;
    expect(toolbar.querySelector('[data-testid="floor-search"]')).not.toBeNull();
    expect(text(toolbar.querySelector('[data-testid="status-filter"]'))).toBe('Status');
    expect(toolbar.querySelectorAll('select').length).toBe(0);
    expect(Array.from(toolbar.querySelectorAll('button')).map(text)).toEqual(['Status']);
    finish();
  }));

  // ── no payment claim ───────────────────────────────────────────

  it('NO PAYMENT CLAIM in anything the view renders or toasts, through every flow', fakeAsync(() => {
    boot();
    const seen: string[] = [];
    for (const c of cards()) {
      open(c.dataset['tableId']!);
      seen.push(text(root()));
    }
    // Every flow that can toast: confirm, decline, all three status actions, a refusal.
    open(IDS.freshHeldTable);
    btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
    settle();
    open(IDS.mixedTable);
    decline(IDS.mixedHeldRound);
    settle();
    open(IDS.freeTable);
    for (const status of ['dirty', 'out_of_service', 'available']) {
      root().querySelector<HTMLButtonElement>(`[data-testid="status-action"][data-status="${status}"]`)!.click();
      settle();
    }
    backend.db.restaurant.acceptingOrders = false;
    open(IDS.staleHeldTable);
    btn(drawerRound(IDS.staleHeldRound)!, 'confirm-round').click();
    settle();
    seen.push(text(root()));

    for (const t of [...seen, ...allToasts()]) {
      const hit = t.match(PAYMENT_CLAIM);
      expect(hit).withContext(hit ? `"${hit[0]}" in: ${t.slice(0, 200)}` : '').toBeNull();
    }
    expect(allToasts().length).toBeGreaterThanOrEqual(5);
    finish();
  }));

  // ── Confirm and Decline ────────────────────────────────────────

  it('CONFIRM: pending until the server answers, then the server’s answer', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    const confirm = btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round');
    confirm.click();
    fixture.detectChanges();

    // Pending: nothing assumed; the round is still held on the server.
    const round = drawerRound(IDS.freshHeldRound)!;
    expect(text(btn(round, 'confirm-round'))).toBe('Confirming…');
    expect(btn(round, 'confirm-round').hasAttribute('disabled')).toBeTrue();
    expect(btn(round, 'decline-round').hasAttribute('disabled')).toBeTrue();
    expect(text(round.querySelector('[data-testid="round-chip"]'))).toBe('Waiting for staff');
    expect(toast.success).not.toHaveBeenCalled();

    settle();
    expect(toast.success).toHaveBeenCalledOnceWith('Round 1 sent to the kitchen');
    expect(backend.round(IDS.freshHeldRound)?.state).toBe('released');
    expect(text(drawerRound(IDS.freshHeldRound)!.querySelector('[data-testid="round-chip"]'))).toBe('Sent to kitchen');
    expect(drawerRound(IDS.freshHeldRound)!.querySelector('[data-testid="confirm-round"]')).toBeNull();
    expect(text(root().querySelector('[data-testid="waiting-count"]'))).toBe('3 waiting');
    finish();
  }));

  it('DECLINE asks first; "Keep order" sends nothing', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    const cmd = spyOn(backend, 'command').and.callThrough();
    btn(drawerRound(IDS.freshHeldRound)!, 'decline-round').click();
    fixture.detectChanges();
    const dialog = root().querySelector('app-dn-dialog [role="dialog"]')!;
    expect(text(dialog.querySelector('h2'))).toBe('Decline this order?');
    expect(text(dialog.querySelector('p'))).toBe('It will not be sent to the kitchen.');
    btn(root(), 'decline-cancel').click();
    fixture.detectChanges();
    settle();
    expect(cmd).not.toHaveBeenCalled();
    expect(backend.round(IDS.freshHeldRound)?.state).toBe('held');
    expect(root().querySelector('[data-testid="decline-confirm"]')).toBeNull();
    finish();
  }));

  it('DECLINE: confirmed, pending, then the round leaves the floor', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    decline(IDS.freshHeldRound);
    expect(text(btn(drawerRound(IDS.freshHeldRound)!, 'decline-round'))).toBe('Declining…');
    expect(btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').hasAttribute('disabled')).toBeTrue();
    settle();
    expect(toast.success).toHaveBeenCalledOnceWith('Round 1 declined. It won’t be sent to the kitchen');
    expect(backend.round(IDS.freshHeldRound)?.state).toBe('declined');
    expect(drawerRound(IDS.freshHeldRound)).toBeNull();
    finish();
  }));

  describe('every 409 reason gets readable copy', () => {
    const cases: { reason: RoundRefusalReason; command: RoundCommand; stage: (b: FloorMockBackend) => void; item?: string }[] = [
      { reason: 'round_declined', command: 'confirm', stage: b => (b.round(IDS.freshHeldRound)!.state = 'declined') },
      {
        reason: 'round_released', command: 'decline',
        stage: b => Object.assign(b.round(IDS.freshHeldRound)!, { state: 'released', heldSince: null, releasedAt: b.clock() }),
      },
      { reason: 'round_not_held', command: 'confirm', stage: b => (b.round(IDS.freshHeldRound)!.state = 'cancelled') },
      // C-2: only a DINER round at a restaurant still onboarding (a suspended one is a 404).
      { reason: 'restaurant_not_trading', command: 'confirm', stage: b => (b.db.restaurant.lifecycle = 'onboarding') },
      { reason: 'ordering_paused', command: 'confirm', stage: b => (b.db.restaurant.acceptingOrders = false) },
      { reason: 'table_menu_only', command: 'confirm', stage: b => (b.table(IDS.freshHeldTable)!.menuOnly = true) },
      { reason: 'table_out_of_service', command: 'confirm', stage: b => (b.table(IDS.freshHeldTable)!.status = 'out_of_service') },
      // C-1: table liveness binds a STAFF round too.
      {
        reason: 'table_out_of_service', command: 'confirm',
        stage: b => {
          b.round(IDS.freshHeldRound)!.source = 'staff';
          b.table(IDS.freshHeldTable)!.status = 'out_of_service';
        },
      },
      {
        reason: 'cannot_be_made', command: 'confirm', item: 'Rolex',
        stage: b => (b.round(IDS.freshHeldRound)!.cannotBeMadeItem = 'Rolex'),
      },
    ];

    for (const [i, c] of cases.entries()) {
      it(`${c.command} refused with ${c.reason} (crossed after the drawer loaded) #${i + 1}`, fakeAsync(() => {
        boot();
        open(IDS.freshHeldTable);
        c.stage(backend); // another device, the kitchen or the owner moved first
        if (c.command === 'confirm') btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
        else decline(IDS.freshHeldRound);
        settle();
        expect(notices()).toEqual([refusalMessage(c.command, c.reason, c.item ?? null)]);
        expect(toast.success).not.toHaveBeenCalled();
        finish();
      }));
    }
  });

  it('a lost answer is UNKNOWN: it says so, claims nothing, and Confirm can be tried again', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    spyOn(backend, 'command').and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
    settle();
    expect(notices()).toEqual([unknownAnswerMessage('confirm')]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').disabled).toBeFalse();
    finish();
  }));

  // ── status actions ─────────────────────────────────────────────

  it('STATUS ACTIONS go through FloorService, never the retired TablesService PUT', fakeAsync(() => {
    boot();
    open(IDS.freeTable);
    const action = (s: string) => root().querySelector<HTMLButtonElement>(`[data-testid="status-action"][data-status="${s}"]`)!;
    expect(Array.from(root().querySelectorAll('[data-testid="status-action"]')).map(text)).toEqual([
      'Mark dirty', 'Mark available', 'Out of service',
    ]);
    expect(action('available').hasAttribute('disabled')).toBeTrue(); // already available

    action('dirty').click();
    fixture.detectChanges();
    expect(action('dirty').getAttribute('aria-busy')).toBe('true');
    settle();
    expect(backend.table(IDS.freeTable)?.status).toBe('dirty');
    expect(toast.success).toHaveBeenCalledWith('T1 marked dirty');

    action('out_of_service').click();
    settle();
    expect(backend.table(IDS.freeTable)?.status).toBe('out_of_service');
    expect(toast.success).toHaveBeenCalledWith('T1 marked out of service');

    action('available').click();
    settle();
    expect(backend.table(IDS.freeTable)?.status).toBe('available');
    expect(toast.success).toHaveBeenCalledWith('T1 marked available');

    expect(tablesService.updateTableStatus).not.toHaveBeenCalled();
    finish();
  }));
  // ── FE-C: refreshing (decision 5) ──────────────────────────────

  describe('REFRESHING: every 5 s while visible, backing off on failure, paused while hidden', () => {
    beforeEach(() => {
      TablesServiceViewComponent.POLL_MS = 5_000;
      TablesServiceViewComponent.BACKOFF_MS = [10_000, 20_000];
    });

    const READ = () => FloorMockBackend.READ_DELAY_MS;

    function create(): void {
      fixture = TestBed.createComponent(TablesServiceViewComponent);
      fixture.detectChanges();
    }

    it('the defaults are 5 s, then 10 s and 20 s after failures', () => {
      expect(pollMs).toBe(5_000);
      expect(backoffMs).toEqual([10_000, 20_000]);
    });

    it('reads at once, then 5 s after each read settles', fakeAsync(() => {
      const reads = spyOn(backend, 'getFloor').and.callThrough();
      create();
      expect(reads).toHaveBeenCalledTimes(1);
      tick(READ() + 4_999);
      expect(reads).toHaveBeenCalledTimes(1);
      tick(1);
      expect(reads).toHaveBeenCalledTimes(2);
      tick(READ() + 5_000);
      expect(reads).toHaveBeenCalledTimes(3);
      finish();
    }));

    it('backs off to 10 s, then 20 s (the cap), and snaps back to 5 s on the first good read', fakeAsync(() => {
      const real = backend.getFloor.bind(backend);
      let failing = true;
      const reads = spyOn(backend, 'getFloor').and.callFake(r =>
        failing ? throwError(() => new HttpErrorResponse({ status: 500 })) : real(r),
      );
      create(); // read 1 fails at t=0
      tick(9_999);
      expect(reads).toHaveBeenCalledTimes(1);
      tick(1); // read 2 at 10 s, fails
      expect(reads).toHaveBeenCalledTimes(2);
      tick(19_999);
      expect(reads).toHaveBeenCalledTimes(2);
      tick(1); // read 3 at +20 s, fails
      expect(reads).toHaveBeenCalledTimes(3);
      tick(20_000); // read 4 at +20 s again (capped)
      expect(reads).toHaveBeenCalledTimes(4);
      failing = false;
      tick(20_000); // read 5 succeeds
      expect(reads).toHaveBeenCalledTimes(5);
      tick(READ() + 5_000); // back to the healthy cadence
      expect(reads).toHaveBeenCalledTimes(6);
      fixture.detectChanges();
      expect(root().querySelector('[data-testid="floor-error"]')).toBeNull();
      finish();
    }));

    it('reads NOTHING while the tab is hidden, and reads at once when it is shown again', fakeAsync(() => {
      const reads = spyOn(backend, 'getFloor').and.callThrough();
      create();
      tick(READ());
      expect(reads).toHaveBeenCalledTimes(1);
      setHidden(true);
      tick(10 * 60_000);
      expect(reads).toHaveBeenCalledTimes(1);
      setHidden(false);
      expect(reads).toHaveBeenCalledTimes(2);
      tick(READ() + 5_000);
      expect(reads).toHaveBeenCalledTimes(3);
      finish();
    }));

    it('a read already in flight when the tab hides lands, but schedules nothing', fakeAsync(() => {
      const reads = spyOn(backend, 'getFloor').and.callThrough();
      create();
      setHidden(true); // read 1 still in flight
      tick(READ());
      fixture.detectChanges();
      expect(cards().length).toBeGreaterThan(0);
      tick(10 * 60_000);
      expect(reads).toHaveBeenCalledTimes(1);
      finish();
    }));

    it('a view opened in a hidden tab reads nothing until it is shown', fakeAsync(() => {
      const reads = spyOn(backend, 'getFloor').and.callThrough();
      pageHidden = true;
      create();
      tick(60_000);
      expect(reads).not.toHaveBeenCalled();
      setHidden(false);
      expect(reads).toHaveBeenCalledTimes(1);
      finish();
    }));

    it('stops for good when the view is destroyed', fakeAsync(() => {
      const reads = spyOn(backend, 'getFloor').and.callThrough();
      create();
      tick(READ());
      fixture.destroy();
      tick(10 * 60_000);
      expect(reads).toHaveBeenCalledTimes(1);
      flush();
    }));
  });

  describe('A SLOW DRAWER READ IS NOT CANCELLED BY THE POLL (Codex P2 on #802)', () => {
    beforeEach(() => {
      TablesServiceViewComponent.POLL_MS = 5_000;
      TablesServiceViewComponent.BACKOFF_MS = [10_000, 20_000];
    });

    it('a table read slower than the poll (6 s, inside the 8 s timeout) still lands, and Confirm is offered', fakeAsync(() => {
      const realTable = backend.getTable.bind(backend);
      const tableReads = spyOn(backend, 'getTable').and.callFake((r, id) =>
        timer(6_000).pipe(switchMap(() => realTable(r, id))),
      );
      fixture = TestBed.createComponent(TablesServiceViewComponent);
      fixture.detectChanges();
      tick(FloorMockBackend.READ_DELAY_MS);
      fixture.detectChanges();
      card(IDS.freshHeldTable).click();
      fixture.detectChanges();
      tick(20_000);
      fixture.detectChanges();
      expect(fixture.componentInstance.detailState).toBe('ready');
      expect(btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round')).not.toBeNull();
      expect(drawerRound(IDS.freshHeldRound)!.querySelectorAll('[data-testid="round-item"]').length).toBe(2);
      // Polls in between left the read in flight alone: no more reads than 20 s of
      // back-to-back 6 s reads allows, and certainly not one per 5 s poll that cancels.
      expect(tableReads.calls.count()).toBeLessThanOrEqual(4);
      finish();
    }));

    it('CONTROL: a command still forces a fresh drawer read while a poll read is in flight', fakeAsync(() => {
      boot();
      open(IDS.freshHeldTable);
      const realTable = backend.getTable.bind(backend);
      const tableReads = spyOn(backend, 'getTable').and.callFake((r, id) =>
        timer(6_000).pipe(switchMap(() => realTable(r, id))),
      );
      tick(5_000); // the poll's floor read lands and starts a slow drawer read
      expect(tableReads).toHaveBeenCalledTimes(1);
      btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
      tick(FloorMockBackend.COMMAND_DELAY_MS);
      expect(tableReads).toHaveBeenCalledTimes(2);
      finish();
    }));
  });

  describe('THE DRAWER IS RE-READ when it opens and after every command', () => {
    it('opening reads the table; Confirm reads it again as soon as the answer lands', fakeAsync(() => {
      boot();
      const tableReads = spyOn(backend, 'getTable').and.callThrough();
      card(IDS.freshHeldTable).click();
      fixture.detectChanges();
      expect(tableReads).toHaveBeenCalledTimes(1);
      settle();
      btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
      fixture.detectChanges();
      expect(tableReads).toHaveBeenCalledTimes(1); // nothing while pending
      tick(FloorMockBackend.COMMAND_DELAY_MS);
      expect(tableReads).toHaveBeenCalledTimes(2); // straight away, not after the floor read
      finish();
    }));

    it('Decline, a refusal, a 404 and an unknown answer each re-read the drawer and the floor', fakeAsync(() => {
      boot();
      open(IDS.freshHeldTable);
      const tableReads = spyOn(backend, 'getTable').and.callThrough();
      const floorReads = spyOn(backend, 'getFloor').and.callThrough();
      const real = backend.command.bind(backend);
      const cmd = spyOn(backend, 'command').and.returnValues(
        throwError(() => new HttpErrorResponse({ status: 0 })),
        throwError(() => new HttpErrorResponse({ status: 404, error: { status: 404, message: 'Not found' } })),
      );
      for (let i = 1; i <= 2; i++) {
        btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
        settle();
        expect(tableReads).withContext(`answer ${i}`).toHaveBeenCalledTimes(i);
        expect(floorReads).withContext(`answer ${i}`).toHaveBeenCalledTimes(i);
      }
      cmd.and.callFake(real);
      backend.round(IDS.freshHeldRound)!.cannotBeMadeItem = 'Rolex';
      btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click(); // 409 cannot_be_made
      settle();
      expect(tableReads).toHaveBeenCalledTimes(3);
      decline(IDS.freshHeldRound); // 200
      settle();
      expect(tableReads).toHaveBeenCalledTimes(4);
      expect(floorReads).toHaveBeenCalledTimes(4);
      finish();
    }));
  });

  // ── FE-C: the answers (decision 6) ─────────────────────────────

  /** Hold every re-read, so what is on screen is the command's answer alone. */
  function holdReReads(): void {
    spyOn(backend, 'getFloor').and.returnValue(NEVER);
    spyOn(backend, 'getTable').and.returnValue(NEVER);
  }

  it('ON 200 THE VIEW TAKES THE RETURNED ROUND, before any re-read lands', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
    fixture.detectChanges();
    holdReReads();
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    fixture.detectChanges();
    const round = drawerRound(IDS.freshHeldRound)!;
    expect(text(round.querySelector('[data-testid="round-chip"]'))).toBe('Sent to kitchen');
    expect(round.querySelector('[data-testid="confirm-round"]')).toBeNull();
    expect(text(card(IDS.freshHeldTable).querySelector('[data-testid="round-chip"]'))).toBe('Sent to kitchen');
    finish();
  }));

  it('ON 409 THE VIEW REPLACES ITS ROUND WITH data.round: a decline crossed by a release shows the release', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    // Another device released the round after this drawer loaded.
    Object.assign(backend.round(IDS.freshHeldRound)!, { state: 'released', heldSince: null, releasedAt: backend.clock() });
    decline(IDS.freshHeldRound);
    holdReReads();
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    fixture.detectChanges();
    expect(notices()).toEqual([refusalMessage('decline', 'round_released', null)]);
    const round = drawerRound(IDS.freshHeldRound)!;
    expect(text(round.querySelector('[data-testid="round-chip"]'))).toBe('Sent to kitchen');
    expect(round.querySelector('[data-testid="decline-round"]')).toBeNull();
    expect(text(card(IDS.freshHeldTable).querySelector('[data-testid="round-chip"]'))).toBe('Sent to kitchen');
    finish();
  }));

  it('ON 409 a round that has LEFT the floor (data.round declined) is removed, its notice kept', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    backend.round(IDS.freshHeldRound)!.state = 'declined';
    btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
    holdReReads();
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    fixture.detectChanges();
    expect(drawerRound(IDS.freshHeldRound)).toBeNull();
    expect(notices()).toEqual([refusalMessage('confirm', 'round_declined', null)]);
    finish();
  }));

  it('ON 409 cannot_be_made the round takes the refusal’s object: badge shown, Confirm disabled', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    backend.round(IDS.freshHeldRound)!.cannotBeMadeItem = 'Rolex';
    btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
    holdReReads();
    tick(FloorMockBackend.COMMAND_DELAY_MS);
    fixture.detectChanges();
    const round = drawerRound(IDS.freshHeldRound)!;
    expect(text(round.querySelector('[data-testid="cannot-be-made"]'))).toBe('Cannot be made — Rolex');
    expect(btn(round, 'confirm-round').disabled).toBeTrue();
    finish();
  }));

  it('ON 404 it says "This order is no longer available." and re-reads the floor', fakeAsync(() => {
    boot();
    open(IDS.freshHeldTable);
    const floorReads = spyOn(backend, 'getFloor').and.callThrough();
    backend.db.restaurant.lifecycle = 'suspended'; // C-2: every floor route is the one 404
    btn(drawerRound(IDS.freshHeldRound)!, 'confirm-round').click();
    settle();
    expect(notices()).toEqual([ORDER_GONE_MESSAGE]);
    expect(ORDER_GONE_MESSAGE).toBe('This order is no longer available.');
    expect(floorReads).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    finish();
  }));

  // ── FE-C: an unknown table status (decision 2) ─────────────────

  describe('AN UNKNOWN TABLE STATUS reads "Status unknown" on that table alone', () => {
    function withStatus(tableId: string, status: string): void {
      const realFloor = backend.getFloor.bind(backend);
      const realTable = backend.getTable.bind(backend);
      const patch = (t: any) => (t.id === tableId ? { ...t, status } : t);
      spyOn(backend, 'getFloor').and.callFake(r =>
        realFloor(r).pipe(map((env: any) => ({ ...env, data: { ...env.data, tables: env.data.tables.map(patch) } }))),
      );
      spyOn(backend, 'getTable').and.callFake((r, id) =>
        realTable(r, id).pipe(map((env: any) => ({ ...env, data: patch(env.data) }))),
      );
    }

    it('the floor still loads: every table shows, and that one reads "Status unknown", never red', fakeAsync(() => {
      withStatus(IDS.freshHeldTable, 'reserved');
      boot();
      expect(root().querySelector('[data-testid="floor-error"]')).toBeNull();
      expect(cards().length).toBe(10);
      const c = card(IDS.freshHeldTable);
      expect(text(c.querySelector('[data-testid="table-status"]'))).toBe('Status unknown');
      expect(RED_CLASS.test(c.className)).toBeFalse();
      expect(text(c.querySelector('[data-testid="round-chip"]'))).toBe('Waiting for staff');
      expect(text(card(IDS.dirtyTable).querySelector('[data-testid="table-status"]'))).toBe('Dirty');
      expect((fixture.componentInstance.floor!.tables.find(t => t.id === IDS.freshHeldTable)!).status).toBe('reserved');
      finish();
    }));

    it('its rounds, Confirm and Decline stay usable, and all three status actions stay enabled', fakeAsync(() => {
      withStatus(IDS.freshHeldTable, 'reserved');
      boot();
      open(IDS.freshHeldTable);
      expect(text(drawer()!.querySelector('[data-testid="drawer-table-status"]'))).toBe('Status unknown');
      const actions = Array.from(root().querySelectorAll<HTMLButtonElement>('[data-testid="status-action"]'));
      expect(actions.map(a => a.disabled)).toEqual([false, false, false]);
      const round = drawerRound(IDS.freshHeldRound)!;
      expect(btn(round, 'decline-round').disabled).toBeFalse();
      btn(round, 'confirm-round').click();
      settle();
      expect(backend.round(IDS.freshHeldRound)?.state).toBe('released');
      expect(toast.success).toHaveBeenCalledWith('Round 1 sent to the kitchen');
      finish();
    }));

    it('Mark available puts it right through the status verb', fakeAsync(() => {
      withStatus(IDS.freeTable, 'closed');
      boot();
      open(IDS.freeTable);
      const status = spyOn(backend, 'setTableStatus').and.callThrough();
      root().querySelector<HTMLButtonElement>('[data-testid="status-action"][data-status="available"]')!.click();
      settle();
      expect(status).toHaveBeenCalledOnceWith('r-1', IDS.freeTable, 'available');
      expect(toast.success).toHaveBeenCalledWith('T1 marked available');
      finish();
    }));

    it('a status filter does not match it (its value is not one of the five)', fakeAsync(() => {
      withStatus(IDS.freshHeldTable, 'reserved');
      boot();
      fixture.componentInstance.statusFilter = ['seated'];
      fixture.detectChanges();
      expect(cards().some(c => c.dataset['tableId'] === IDS.freshHeldTable)).toBeFalse();
      finish();
    }));
  });

  it('A STATUS ACTION the server refuses says so once, in the server’s words', fakeAsync(() => {
    boot();
    open(IDS.freeTable);
    spyOn(backend, 'setTableStatus').and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found', error: { status: 404, message: 'Table not found' } })),
    );
    root().querySelector<HTMLButtonElement>('[data-testid="status-action"][data-status="dirty"]')!.click();
    settle();
    expect(toast.error).toHaveBeenCalledOnceWith('T1 wasn’t updated. Table not found');
    finish();
  }));
});
