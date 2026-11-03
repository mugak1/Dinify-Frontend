import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
} from '@angular/core/testing';
import { of } from 'rxjs';

import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';
import { KitchenTicket } from '../models/kitchen.models';
import {
  OVERDUE_MS,
  WARNING_MS,
  sortTickets,
  ticketStartedAt,
} from '../services/kitchen-logic';
import { KitchenOrderService } from '../services/kitchen-order.service';
import { readFeed, readReleasedAt } from '../services/kitchen-wire';
import { BoardComponent } from './board.component';
import { TicketCardComponent } from './ticket-card/ticket-card.component';

/**
 * Step 2 (FE-A): a ticket ages from when its round was RELEASED to the kitchen.
 *
 * A diner's round can be held for staff before it reaches the kitchen, so
 * `created_at` can be minutes older than the moment the kitchen first saw the
 * order. Ageing from it would put a just-released ticket on the board already
 * amber or red. The backend (BE-C) adds an OPTIONAL `released_at`; this client
 * may meet a server that sends it or one that does not, so every start-time
 * consumer reads `released_at ?? created_at` through `ticketStartedAt`, and the
 * wire parser keeps `released_at` only when it is a readable instant.
 *
 * The rows enter through the REAL `readFeed`, so the parser and the consumers
 * are tested together, not against a hand-built ticket the wire never produces.
 */

const NOW = Date.parse('2026-11-03T12:00:00Z');
const minsAgo = (m: number): string => new Date(NOW - m * 60_000).toISOString();

/** A wire row as the kitchen feed sends it. `extra` carries `released_at` or not. */
function row(
  id: string,
  createdMinsAgo: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    order_number: 1,
    table_label: 'Table 4',
    order_source: 'diner_self_service',
    fulfilment_status: 'new',
    priority: false,
    created_at: minsAgo(createdMinsAgo),
    served_at: null,
    items: [],
    ...extra,
  };
}

/** One ticket, read through the real wire parser. */
function parsed(raw: Record<string, unknown>): KitchenTicket {
  const verdict = readFeed({ data: { records: [raw] } });
  if (verdict.kind !== 'ok') throw new Error(`feed unreadable: ${verdict.why}`);
  return verdict.tickets[0];
}

const MALFORMED: ReadonlyArray<[string, unknown]> = [
  ['an unparseable string', 'not-a-date'],
  ['a naive timestamp with no offset', '2026-11-03T11:58:00'],
  ['an empty string', ''],
  ['a number', NOW],
  ['an object', { at: minsAgo(2) }],
  ['an impossible instant', '2026-13-45T99:99:00Z'],
];

describe('Kitchen ticket ages from release (Step 2 FE-A)', () => {
  describe('wire parser: released_at', () => {
    it('keeps a readable, offset-bearing released_at verbatim', () => {
      const t = parsed(row('a', 20, { released_at: '2026-11-03T14:58:00+03:00' }));
      expect(t.released_at).toBe('2026-11-03T14:58:00+03:00');
    });

    it('leaves released_at ABSENT when the server did not send it (older servers)', () => {
      const t = parsed(row('a', 20));
      expect('released_at' in t).toBeFalse();
    });

    it('treats an explicit null as "not given" and invents nothing', () => {
      const t = parsed(row('a', 20, { released_at: null }));
      expect('released_at' in t).toBeFalse();
      expect(t.created_at).toBe(minsAgo(20));
    });

    for (const [label, value] of MALFORMED) {
      it(`drops ${label} without refusing the feed`, () => {
        const verdict = readFeed({ data: { records: [row('a', 20, { released_at: value })] } });
        expect(verdict.kind).toBe('ok');
        if (verdict.kind !== 'ok') return;
        expect('released_at' in verdict.tickets[0]).toBeFalse();
        expect(readReleasedAt(value)).toBeUndefined();
      });
    }

    it('does not write to the response it read', () => {
      const raw = row('a', 20, { released_at: 'not-a-date' });
      readFeed({ data: { records: [raw] } });
      expect(raw['released_at']).toBe('not-a-date');
    });
  });

  describe('ticket card: age and colour thresholds', () => {
    let fixture: ComponentFixture<TicketCardComponent>;
    let card: TicketCardComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [TicketCardComponent] }).compileComponents();
      fixture = TestBed.createComponent(TicketCardComponent);
      card = fixture.componentInstance;
      card.now = NOW;
    });

    it('a ticket with released_at ages from it, not from created_at', () => {
      card.ticket = parsed(row('a', 20, { released_at: minsAgo(2) }));
      expect(card.age).toBe('2:00');
      expect(card.escalation).toBe('normal');
    });

    it('a ticket without released_at ages from created_at, exactly as before', () => {
      card.ticket = parsed(row('a', 20));
      expect(card.age).toBe('20:00');
      expect(card.escalation).toBe('overdue');
    });

    for (const [label, value] of MALFORMED) {
      it(`a ticket whose released_at is ${label} falls back to created_at`, () => {
        card.ticket = parsed(row('a', 20, { released_at: value }));
        expect(card.age).toBe('20:00');
        expect(card.escalation).toBe('overdue');
      });
    }

    it('the amber threshold is measured from the release time', () => {
      const warnMin = WARNING_MS / 60_000;
      card.ticket = parsed(row('a', 60, { released_at: minsAgo(warnMin - 1) }));
      expect(card.escalation).toBe('normal');
      card.ticket = parsed(row('a', 60, { released_at: minsAgo(warnMin) }));
      expect(card.escalation).toBe('warning');
    });

    it('the red threshold is measured from the release time', () => {
      const overdueMin = OVERDUE_MS / 60_000;
      card.ticket = parsed(row('a', 60, { released_at: minsAgo(overdueMin - 1) }));
      expect(card.escalation).toBe('warning');
      card.ticket = parsed(row('a', 60, { released_at: minsAgo(overdueMin) }));
      expect(card.escalation).toBe('overdue');
    });

    it('renders the release-based age and no "Overdue" chip for a just-released ticket', () => {
      card.ticket = parsed(row('a', 40, { released_at: minsAgo(1) }));
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('1:00');
      expect(text).not.toContain('Overdue');
      expect(text).not.toContain('Due soon');
    });
  });

  describe('sort order uses the same start time', () => {
    it('orders by release time, not creation time, within a priority band', () => {
      // `held` was created FIRST but released LAST: it joins the queue behind `direct`.
      const held = parsed(row('held', 30, { released_at: minsAgo(1) }));
      const direct = parsed(row('direct', 10));
      expect(sortTickets([held, direct], NOW).map(t => t.id)).toEqual(['direct', 'held']);
    });

    it('falls back to created_at for a ticket with no readable release time', () => {
      const malformed = parsed(row('malformed', 30, { released_at: 'not-a-date' }));
      const released = parsed(row('released', 40, { released_at: minsAgo(5) }));
      expect(sortTickets([released, malformed], NOW).map(t => t.id))
        .toEqual(['malformed', 'released']);
    });

    it('priority still outranks start time', () => {
      const old = parsed(row('old', 30));
      const urgent = parsed(row('urgent', 30, { priority: true, released_at: minsAgo(1) }));
      expect(sortTickets([old, urgent], NOW).map(t => t.id)).toEqual(['urgent', 'old']);
    });

    it('ticketStartedAt is released_at ?? created_at', () => {
      expect(ticketStartedAt(parsed(row('a', 30, { released_at: minsAgo(3) })))).toBe(minsAgo(3));
      expect(ticketStartedAt(parsed(row('a', 30)))).toBe(minsAgo(30));
    });
  });

  describe('board: overdue checks and jumps read the same start time', () => {
    let fixture: ComponentFixture<BoardComponent>;
    let board: BoardComponent;
    let records: Record<string, unknown>[];

    beforeEach(async () => {
      records = [];
      const apiStub = {
        get: jasmine.createSpy('get').and.callFake((_: any, url: string) =>
          url === 'kitchen/orders/completed/'
            ? of({ status: 200, data: { records: [] } })
            : of({ status: 200, data: { records } })),
        postPatch: jasmine.createSpy('postPatch').and.returnValue(of({})),
      };
      const membership = { restaurant_id: 'r1', restaurant: 'R', roles: ['kitchen'] };
      const authStub = {
        userValue: { profile: { restaurant_roles: [membership] } },
        currentRestaurantRole: membership,
      };
      await TestBed.configureTestingModule({
        imports: [BoardComponent],
        providers: [
          { provide: ApiService, useValue: apiStub },
          { provide: AuthenticationService, useValue: authStub },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(BoardComponent);
      board = fixture.componentInstance;
    });

    function load(rows: Record<string, unknown>[]): void {
      records = rows;
      fixture.detectChanges(); // ngOnInit → first poll (sync stub)
      board.now.set(NOW);
    }

    it('a long-held, just-released ticket is not overdue on the board', fakeAsync(() => {
      load([row('held', 40, { released_at: minsAgo(1) })]);
      expect(board.hasOverdue).toBeFalse();
      fixture.destroy();
      discardPeriodicTasks();
    }));

    it('an old ticket with no (or a malformed) release time is still overdue', fakeAsync(() => {
      load([row('legacy', 40), row('bad', 40, { released_at: 'not-a-date' })]);
      expect(board.hasOverdue).toBeTrue();
      fixture.destroy();
      discardPeriodicTasks();
    }));

    it('the overdue cue tracks the release time', fakeAsync(() => {
      load([
        row('held', 40, { released_at: minsAgo(1) }),
        row('legacy', 40),
      ]);
      (board as any).overdueFired = null;
      (board as any).detectOverdue(NOW);
      expect([...(board as any).overdueFired as Set<string>]).toEqual(['legacy']);
      fixture.destroy();
      discardPeriodicTasks();
    }));

    it('jumpFirstOverdue skips a held ticket that was just released', fakeAsync(() => {
      load([
        row('held', 40, { released_at: minsAgo(1) }),
        row('legacy', 20),
      ]);
      const jump = spyOn(board as any, 'jumpToTicket');
      board.jumpFirstOverdue();
      const index = jump.calls.mostRecent().args[0] as number;
      expect(board.tickets()[index].id).toBe('legacy');
      fixture.destroy();
      discardPeriodicTasks();
    }));

    it('jumpOldest / jumpNewest pick by start time', fakeAsync(() => {
      load([
        row('held', 40, { released_at: minsAgo(1) }),
        row('direct', 10),
      ]);
      const jump = spyOn(board as any, 'jumpToTicket');
      board.jumpOldest();
      expect(board.tickets()[jump.calls.mostRecent().args[0] as number].id).toBe('direct');
      board.jumpNewest();
      expect(board.tickets()[jump.calls.mostRecent().args[0] as number].id).toBe('held');
      fixture.destroy();
      discardPeriodicTasks();
    }));

    it('the active feed is sorted by start time through the real service', fakeAsync(() => {
      load([
        row('held', 40, { released_at: minsAgo(1) }),
        row('direct', 10),
      ]);
      const service = TestBed.inject(KitchenOrderService);
      expect(service.activeTickets().map(t => t.id)).toEqual(['direct', 'held']);
      fixture.destroy();
      discardPeriodicTasks();
    }));
  });
});
