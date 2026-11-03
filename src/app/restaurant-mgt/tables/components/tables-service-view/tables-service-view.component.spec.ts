import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { map, throwError } from 'rxjs';
import { TablesServiceViewComponent } from './tables-service-view.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { AuthenticationService } from '../../../../_services/authentication.service';
import { TablesService } from '../../services/tables.service';
import { FloorMockBackend } from '../../services/floor-mock-backend';
import { FLOOR_DEV_MODE } from '../../services/floor-view-gate';
import { MOCK_FLOOR_IDS as IDS } from '../../data/floor-mock-data';
import { RoundCommand, RoundRefusalReason } from '../../models/floor.models';
import { refusalMessage, unknownAnswerMessage } from '../../utils/floor-presentation';
import { PAYMENT_CLAIM, RED_CLASS } from '../../utils/floor-claims.testing';

/**
 * The floor view (Step 2) end to end: the real component tree, the real FloorService
 * and the mock backend answering in floor contract v1. Only the toast, the signed-in
 * restaurant and the (unused) TablesService are stood in for.
 */
describe('TablesServiceViewComponent — floor view (Step 2)', () => {
  let fixture: ComponentFixture<TablesServiceViewComponent>;
  let backend: FloorMockBackend;
  let toast: jasmine.SpyObj<ToastService>;
  let tablesService: jasmine.SpyObj<TablesService>;
  const pollMs = TablesServiceViewComponent.POLL_MS;

  /** Every control a Step 2 drawer may show. Anything else is a hidden control leaking back. */
  const ALLOWED_DRAWER_BUTTONS = new Set([
    'Close', 'Confirm', 'Decline', 'Mark dirty', 'Mark available', 'Out of service', 'Try again',
  ]);
  /** The parked controls, by any name they have carried. */
  const PARKED_CONTROL = /walk-in|seat |mark paid|paid|off-system|print|bill\b|waitlist|change server|server|note|merge|split|transfer|reservation|full order/i;

  beforeEach(() => {
    TablesServiceViewComponent.POLL_MS = 10 * 60_000; // keep background polls out of the way
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warning', 'clear']);
    tablesService = jasmine.createSpyObj<TablesService>('TablesService', ['updateTableStatus', 'updateTable', 'seatWalkIn']);
    TestBed.configureTestingModule({
      imports: [TablesServiceViewComponent],
      providers: [
        { provide: FLOOR_DEV_MODE, useValue: true },
        { provide: ToastService, useValue: toast },
        { provide: TablesService, useValue: tablesService },
        { provide: AuthenticationService, useValue: { currentRestaurantRole: { restaurant_id: 'r-1' } } },
      ],
    });
    backend = TestBed.inject(FloorMockBackend);
  });

  afterEach(() => {
    TablesServiceViewComponent.POLL_MS = pollMs;
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
      { reason: 'restaurant_not_trading', command: 'confirm', stage: b => (b.db.restaurant.trading = false) },
      { reason: 'restaurant_not_trading', command: 'decline', stage: b => (b.db.restaurant.trading = false) },
      { reason: 'ordering_paused', command: 'confirm', stage: b => (b.db.restaurant.acceptingOrders = false) },
      { reason: 'table_menu_only', command: 'confirm', stage: b => (b.table(IDS.freshHeldTable)!.menuOnly = true) },
      { reason: 'table_out_of_service', command: 'confirm', stage: b => (b.table(IDS.freshHeldTable)!.status = 'out_of_service') },
      {
        reason: 'cannot_be_made', command: 'confirm', item: 'Rolex',
        stage: b => (b.round(IDS.freshHeldRound)!.cannotBeMadeItem = 'Rolex'),
      },
    ];

    for (const c of cases) {
      it(`${c.command} refused with ${c.reason} (crossed after the drawer loaded)`, fakeAsync(() => {
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
});
