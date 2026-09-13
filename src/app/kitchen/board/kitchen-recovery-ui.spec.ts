/**
 * K2, AT THE CONSUMERS.
 *
 * The service can retain a command, reconcile it and refuse to forget it, and
 * none of that reaches a cook unless the board and the card actually render it.
 * Two live consumers bypassed the new surface until this change:
 *
 *   * the notice renders INSIDE a ticket card, so a lost CANCELLATION — which
 *     removes the order from both feeds — took its own warning off the screen.
 *     The one command whose uncertainty matters most was the one nobody was
 *     told about;
 *   * the card offered a single OK, which DELETED an unresolved operation, and
 *     re-enabled its controls as soon as the request was no longer in flight.
 *
 * These drive the REAL service through the REAL components.
 */

import {
  ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync,
} from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket, TicketOperation } from '../models/kitchen.models';
import { KitchenOrderService } from '../services/kitchen-order.service';
import { BoardComponent } from './board.component';
import { TicketCardComponent } from './ticket-card/ticket-card.component';

function makeTicket(partial: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: 't1',
    order_number: 7,
    table_label: 'Table 9',
    order_source: 'server_assisted',
    fulfilment_status: 'preparing',
    priority: false,
    created_at: new Date().toISOString(),
    served_at: null,
    items: [],
    order_status: 'pending',
    fulfilment_revision: 0,
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────────
describe('Kitchen card recovery affordances (K2 consumer)', () => {
  let fixture: ComponentFixture<TicketCardComponent>;
  let component: TicketCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TicketCardComponent] })
      .compileComponents();
    fixture = TestBed.createComponent(TicketCardComponent);
    component = fixture.componentInstance;
  });

  function render(operation: TicketOperation): HTMLElement {
    component.ticket = makeTicket();
    component.now = Date.now();
    component.canCommand = true;
    component.operation = operation;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const unknown: TicketOperation = {
    orderId: 't1', phase: 'unknown', label: 'Cancelling', ifRevision: 0,
    message: 'We could not confirm this with the kitchen server.',
  };

  it('offers recovery — never a dismissal — while the outcome is open', () => {
    const el = render(unknown);

    expect(el.querySelector('[data-testid="ticket-operation-check"]'))
      .withContext('the operator can ask what the order is now')
      .toBeTruthy();
    expect(el.querySelector('[data-testid="ticket-operation-retry"]'))
      .withContext('and can re-send the same command')
      .toBeTruthy();
    expect(el.querySelector('[data-testid="ticket-operation-ok"]'))
      .withContext('OK on an open question silently meant "abandon it"')
      .toBeNull();
  });

  it('emits check and retry from those buttons', () => {
    const el = render(unknown);
    const check = jasmine.createSpy('check');
    const retry = jasmine.createSpy('retry');
    component.checkRequested.subscribe(check);
    component.retryRequested.subscribe(retry);

    (el.querySelector('[data-testid="ticket-operation-check"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid="ticket-operation-retry"]') as HTMLButtonElement).click();

    expect(check).toHaveBeenCalled();
    expect(retry).toHaveBeenCalled();
  });

  it('withholds the controls while the ANSWER is outstanding, not merely the request',
     () => {
    render(unknown);
    expect(component.commandsEnabled)
      .withContext('a lost reply left the card open to a fresh command at a '
                 + 'refreshed revision — a different question, asked as the same')
      .toBeFalse();

    render({ ...unknown, phase: 'checking' });
    expect(component.commandsEnabled).toBeFalse();
  });

  it('disables both recovery buttons while a check is already in flight', () => {
    const el = render({ ...unknown, phase: 'checking' });
    const check = el.querySelector('[data-testid="ticket-operation-check"]') as HTMLButtonElement;
    const retry = el.querySelector('[data-testid="ticket-operation-retry"]') as HTMLButtonElement;
    expect(check.disabled).toBeTrue();
    expect(retry.disabled).toBeTrue();
  });

  it('offers a dismissal only once the question is SETTLED', () => {
    const resolved = render({
      ...unknown, phase: 'resolved', message: 'This order is now cancelled.',
    });
    expect(resolved.querySelector('[data-testid="ticket-operation-ok"]')).toBeTruthy();
    expect(resolved.querySelector('[data-testid="ticket-operation-check"]')).toBeNull();

    const conflict = render({
      ...unknown, phase: 'conflict', reason: 'kitchen_precondition_stale',
      message: 'This ticket changed.',
    });
    expect(conflict.querySelector('[data-testid="ticket-operation-ok"]')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Kitchen board detached-operation strip (K2 consumer)', () => {
  let fixture: ComponentFixture<BoardComponent>;
  let service: KitchenOrderService;
  let commandSubject: Subject<any>;
  let records: any[];

  beforeEach(async () => {
    records = [makeTicket()];
    commandSubject = new Subject<any>();
    const apiStub = {
      get: jasmine.createSpy('get').and.callFake((_: any, url: string) =>
        url === 'kitchen/orders/completed/'
          ? of({ status: 200, kitchen_protocol: 1, data: { records: [] } })
          : of({ status: 200, kitchen_protocol: 1, data: { records } })),
      postPatch: jasmine.createSpy('postPatch')
        .and.callFake(() => commandSubject.asObservable()),
    };
    const authStub = {
      userValue: { profile: { id: 'u1', restaurant_roles: [] } },
      currentRestaurantRole:
        { restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] },
    };
    await TestBed.configureTestingModule({
      imports: [BoardComponent],
      providers: [
        { provide: ApiService, useValue: apiStub },
        { provide: AuthenticationService, useValue: authStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoardComponent);
    service = TestBed.inject(KitchenOrderService);
  });

  /** Lose a cancellation, then let the order leave both feeds. */
  function loseACancellation(): void {
    fixture.detectChanges();                     // ngOnInit → first poll
    expect(service.cancelOrder('t1', 'customer_request')).toBeTrue();
    commandSubject.error({ status: 0, statusText: 'Unknown Error' });

    records = [];                                // cancelled: in neither feed
    service.loadActive().subscribe({ error: () => undefined });
    fixture.detectChanges();
  }

  it('keeps the warning on screen after the card it lived in has gone',
     fakeAsync(() => {
    loseACancellation();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-kitchen-ticket-card').length)
      .withContext('the order is on neither board')
      .toBe(0);

    const strip = el.querySelector('[data-testid="kitchen-detached-operations"]');
    expect(strip)
      .withContext('a lost cancellation must not take its own warning with it')
      .toBeTruthy();
    expect(strip!.textContent).toContain('Cancelling');
    expect(el.querySelectorAll('[data-testid="detached-operation"]').length).toBe(1);

    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('drives the reconciliation read from the strip', fakeAsync(() => {
    loseACancellation();
    const spy = spyOn(service, 'reconcile').and.callThrough();

    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="detached-operation-check"]') as HTMLButtonElement)
      .click();

    expect(spy).toHaveBeenCalledWith('t1');

    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('drives an explicit retry from the strip', fakeAsync(() => {
    loseACancellation();
    const spy = spyOn(service, 'retry').and.callThrough();

    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="detached-operation-retry"]') as HTMLButtonElement)
      .click();

    expect(spy).toHaveBeenCalledWith('t1');

    fixture.destroy();
    discardPeriodicTasks();
  }));

  it('shows no strip at all when nothing is unresolved', fakeAsync(() => {
    fixture.detectChanges();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="kitchen-detached-operations"]')).toBeNull();

    fixture.destroy();
    discardPeriodicTasks();
  }));
});
