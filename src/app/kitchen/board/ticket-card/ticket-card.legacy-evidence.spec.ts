/**
 * D12 B3 — the kitchen card says what the server can and cannot vouch for.
 *
 * The Backend publishes three markers on every kitchen line and extra
 * (`item_name_provenance`, `modifiers_provenance`, `allergen_tags_provenance`),
 * each `snapshot` or `missing`. `missing` means the reader cannot establish
 * that the value beside it is what was captured when the line was ordered. It
 * does NOT mean nothing was recorded, and an empty captured allergen list is
 * never an assurance that the dish is allergen-free.
 *
 * Before this change the card printed the stored values and nothing else, so a
 * legacy line was a bold blank name with no options and no allergen chips: on a
 * kitchen board that reads as "a dish with no options and no allergens".
 *
 * EVERYTHING HERE GOES THROUGH THE PATH THE APP TAKES: the real `ApiService`,
 * the real `HttpClient` (its XHR backend replaced by `HttpTestingController`),
 * the real `KitchenOrderService` with its `readFeed` validation, and the real
 * `TicketCardComponent`. The feeds are RECORDED Backend bytes (see the fixtures
 * file for their producer and digests), not hand-authored provenance. Where a
 * case needs a marker the producer never emits (an invalid value, a partial
 * set) it is DERIVED from those bytes with exactly one field changed, and says
 * so in its name.
 */

import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';

import { environment } from '../../../../environments/environment';
import { ApiService } from '../../../_services/api.service';
import { AuthenticationService } from '../../../_services/authentication.service';
import { KitchenTicket } from '../../models/kitchen.models';
import { KitchenOrderService } from '../../services/kitchen-order.service';
import { TicketCardComponent } from './ticket-card.component';
import {
  RECORDED_KITCHEN_FEEDS,
  RECORDED_SCENARIOS,
  RecordedKitchenFeed,
} from './ticket-card.legacy-evidence.fixtures';

const API = `${environment.apiUrl}/api/${environment.version}`;

/** The application's own words. Anything else in a notice is a regression. */
const NAME_UNAVAILABLE = 'Item name unavailable';
const NAME_UNVERIFIED = 'Item name unverified';
const OPTIONS_UNVERIFIED = 'Options unverified — check before preparing';
const ALLERGENS_UNVERIFIED = 'Allergen information unverified — check before preparing';

/** A fixed clock, so age and recall-window rendering cannot vary between runs. */
const NOW = Date.parse('2026-10-14T04:00:00+03:00');

const MARKERS = [
  'item_name_provenance', 'modifiers_provenance', 'allergen_tags_provenance',
] as const;

function recorded(producer: RecordedKitchenFeed['producer'],
                  feed: RecordedKitchenFeed['feed']): RecordedKitchenFeed {
  const found = RECORDED_KITCHEN_FEEDS.find(
    f => f.producer === producer && f.feed === feed);
  if (!found) throw new Error(`no recorded ${producer} ${feed} feed`);
  return found;
}

/** The order the probe created for one scenario, looked up by its description. */
function scenario(producer: RecordedKitchenFeed['producer'], description: string): string {
  const entry = Object.entries(RECORDED_SCENARIOS[producer].byId)
    .find(([, d]) => d === description);
  if (!entry) throw new Error(`no ${producer} scenario "${description}"`);
  return entry[0];
}

const CAPTURED = 'active: captured parent, captured extras, captured-empty pasta and bacon';
const LEGACY = 'active: every line legacy-shaped';
const MIXED = 'active: legacy Cheese Slice extra under a captured Beef Burger';
const BLANKED = 'active: Beef Burger name blanked, its stored lists kept';
const DONE_CAPTURED = 'completed: captured, served via commands';
const DONE_LEGACY = 'completed: every line legacy-shaped, served via commands';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as any)) deepFreeze(child);
  }
  return value;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** What one rendered line shows: its name slot, its own notices, its text. */
interface RenderedLine {
  name: string;
  notices: string[];
  text: string;
  /** Element children of the line: 1 is the name row alone, with nothing added. */
  parts: number;
  extras: RenderedLine[];
}

function noticesOf(el: HTMLElement, line: 'parent' | 'extra'): string[] {
  return Array.from(el.querySelectorAll<HTMLElement>('[data-testid="line-evidence"]'))
    .filter(n => n.getAttribute('data-line') === line)
    .map(n => (n.textContent ?? '').trim());
}

/** The name slot: the second span of a line's first row, whatever it holds. */
function nameSlot(el: HTMLElement): string {
  const slot = el.querySelector<HTMLElement>(':scope > div.flex > span:nth-of-type(2)');
  return (slot?.textContent ?? '').trim();
}

/**
 * Read the card through its EXISTING structure (one `div` per line inside the
 * scrolling list, one per extra inside its `space-y-1` block), so these specs
 * locate lines identically before and after the change and fail, when they
 * fail, on what the lines say.
 */
function readLines(card: HTMLElement): RenderedLine[] {
  const parents = Array.from(
    card.querySelectorAll<HTMLElement>('article > div.overflow-y-auto > div'));
  return parents.map(p => ({
    name: nameSlot(p),
    notices: noticesOf(p, 'parent'),
    text: (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
    parts: p.children.length,
    extras: Array.from(p.querySelectorAll<HTMLElement>(':scope > div.space-y-1 > div'))
      .map(e => ({
        name: nameSlot(e),
        notices: noticesOf(e, 'extra'),
        text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
        parts: e.children.length,
        extras: [],
      })),
  }));
}

function allNotices(card: HTMLElement): string[] {
  return Array.from(card.querySelectorAll<HTMLElement>('[data-testid="line-evidence"]'))
    .map(n => (n.textContent ?? '').trim());
}

const CLEAN: string[] = [];
const LEGACY_PARENT = [NAME_UNAVAILABLE, OPTIONS_UNVERIFIED, ALLERGENS_UNVERIFIED];
const LEGACY_EXTRA = [NAME_UNAVAILABLE, ALLERGENS_UNVERIFIED];

describe('D12 B3 — recorded kitchen feeds through the real HTTP path to the card', () => {
  let service: KitchenOrderService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TicketCardComponent],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        ApiService,
        KitchenOrderService,
        {
          provide: AuthenticationService,
          useValue: {
            userValue: { profile: { id: 'u1', restaurant_roles: [] } },
            currentRestaurantRole:
              { restaurant_id: 'r1', restaurant: 'R', roles: ['owner'] },
          },
        },
      ],
    }).compileComponents();
    service = TestBed.inject(KitchenOrderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /**
   * Deliver one recorded body through the real feed path. The parsed body is
   * deep-frozen first, so any write into it by the reader throws, and it is
   * returned so the caller can prove it still serialises to the recorded text.
   */
  function deliver(feed: RecordedKitchenFeed, edit?: (raw: any) => void): any {
    const raw = JSON.parse(feed.body);
    edit?.(raw);
    deepFreeze(raw);
    const load = feed.feed === 'active' ? service.loadActive() : service.loadCompleted();
    load.subscribe({ error: () => undefined });
    httpMock.expectOne(r => r.url.startsWith(`${API}/kitchen/orders/${feed.feed}/`))
      .flush(raw);
    return raw;
  }

  function stored(feed: RecordedKitchenFeed['feed'], id: string): KitchenTicket {
    const list = feed === 'active' ? service.activeTickets() : service.completedTickets();
    const found = list.find(t => t.id === id);
    if (!found) throw new Error(`order ${id} is not on the ${feed} board`);
    return found;
  }

  function render(ticket: KitchenTicket, completed: boolean): HTMLElement {
    const fixture = TestBed.createComponent(TicketCardComponent);
    fixture.componentRef.setInput('ticket', ticket);
    fixture.componentRef.setInput('now', NOW);
    fixture.componentRef.setInput('completed', completed);
    fixture.componentRef.setInput('canCommand', service.canCommand());
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // ── The fixtures are the recorded bytes ─────────────────────────────

  it('embeds each recorded body byte for byte (digest, length and ticket count)',
     async () => {
    expect(RECORDED_KITCHEN_FEEDS.length).toBe(4);
    for (const feed of RECORDED_KITCHEN_FEEDS) {
      expect(await sha256Hex(feed.body))
        .withContext(`${feed.producer} ${feed.feed}: ${feed.source}`)
        .toBe(feed.sha256);
      expect(new TextEncoder().encode(feed.body).length).toBe(feed.bytes);
      expect(JSON.parse(feed.body).data.length).toBe(feed.tickets);
    }
  });

  // ── The delivered producer, active board ────────────────────────────

  describe('a producer that publishes the markers (active board)', () => {
    const feed = recorded('delivered', 'active');

    it('keeps a fully captured order exactly as it was: no notices at all', () => {
      deliver(feed);
      const card = render(stored('active', scenario('delivered', CAPTURED)), false);
      const [pasta, burger] = readLines(card);

      expect(allNotices(card)).toEqual(CLEAN);
      expect(pasta.name).toBe('Pasta_autodel7 Classic');
      expect(burger.name).toBe('Beef Burger');
      expect(burger.text).toContain('Size: Large');
      expect(burger.text).toContain('Peanuts');
      expect(burger.extras.map(e => e.name)).toEqual(['Bacon Strip', 'Cheese Slice']);
      expect(burger.extras[1].text).toContain('Milk');
    });

    it('says a CAPTURED-EMPTY line is captured, and nothing more: no assurance', () => {
      // Pasta and Bacon Strip were ordered with no options and no allergens, and
      // the server vouches for that. The card shows what it always showed — and,
      // in particular, does not turn an empty list into "allergen-free".
      deliver(feed);
      const card = render(stored('active', scenario('delivered', CAPTURED)), false);
      const [pasta, burger] = readLines(card);

      expect(pasta.notices).toEqual(CLEAN);
      expect(pasta.name).toBe('Pasta_autodel7 Classic');
      expect(pasta.parts).withContext('the name row and nothing else').toBe(1);
      expect(burger.extras[0].notices).toEqual(CLEAN);
      expect(burger.extras[0].name).toBe('Bacon Strip');
      expect(burger.extras[0].parts).withContext('the name row and nothing else').toBe(1);
      expect(allNotices(card)).toEqual(CLEAN);
    });

    it('cautions on every field of a legacy order, parent and extra alike', () => {
      deliver(feed);
      const card = render(stored('active', scenario('delivered', LEGACY)), false);
      const lines = readLines(card);

      expect(lines.length).toBe(2);
      for (const line of lines) {
        expect(line.name).withContext('an empty stored name is called unavailable')
          .toBe(NAME_UNAVAILABLE);
        expect(line.notices).toEqual(LEGACY_PARENT);
      }
      expect(lines[1].extras.length).toBe(2);
      for (const extra of lines[1].extras) {
        expect(extra.name).toBe(NAME_UNAVAILABLE);
        expect(extra.notices)
          .withContext('an extra gets the name and allergen cautions, not an options one')
          .toEqual(LEGACY_EXTRA);
      }
    });

    it('cautions on the legacy extra ONLY, under a captured parent', () => {
      deliver(feed);
      const card = render(stored('active', scenario('delivered', MIXED)), false);
      const [pasta, burger] = readLines(card);

      expect(pasta.notices).toEqual(CLEAN);
      expect(burger.notices).withContext('nothing leaks up to the parent').toEqual(CLEAN);
      expect(burger.name).toBe('Beef Burger');
      expect(burger.extras[0].notices).withContext('nor across to its sibling')
        .toEqual(CLEAN);
      expect(burger.extras[1].name).toBe(NAME_UNAVAILABLE);
      expect(burger.extras[1].notices).toEqual(LEGACY_EXTRA);
    });

    it('keeps the stored options and allergens of a blanked line, and cautions on them',
       () => {
      // The name was blanked out of band; the lists beside it are still stored.
      // The server cannot vouch for them (the co-write convention it reads them
      // by keys on the name), so they are shown AND flagged — never erased.
      deliver(feed);
      const card = render(stored('active', scenario('delivered', BLANKED)), false);
      const [pasta, burger] = readLines(card);

      expect(pasta.notices).toEqual(CLEAN);
      expect(burger.name).toBe(NAME_UNAVAILABLE);
      expect(burger.notices).toEqual(LEGACY_PARENT);
      expect(burger.text).withContext('the stored option is still shown').toContain('Size: Large');
      expect(burger.text).withContext('the stored allergen chip is still shown').toContain('Peanuts');
      expect(burger.extras.map(e => e.notices))
        .withContext('captured extras under a blanked parent stay clean')
        .toEqual([CLEAN, CLEAN]);
    });

    it('stores exactly what was sent, without writing into the response', () => {
      const raw = deliver(feed);

      expect(JSON.stringify(raw))
        .withContext('the parsed response still serialises to the recorded bytes')
        .toBe(feed.body);
      expect(service.feedUnreadable()).toBeFalse();
      expect(service.canCommand()).toBeTrue();
      for (const wire of raw.data) {
        const held = stored('active', wire.id);
        expect(held.order_number).toBe(wire.order_number);
        expect(held.fulfilment_revision).toBe(wire.fulfilment_revision);
        expect(held.fulfilment_status).toBe(wire.fulfilment_status);
        expect(held.order_status).toBe(wire.order_status);
        expect(held.items.length).toBe(wire.items.length);
        held.items.forEach((line: any, i: number) => {
          const sent = wire.items[i];
          expect(line.item_name_snapshot).toBe(sent.item_name_snapshot);
          expect(line.quantity).toBe(sent.quantity);
          expect(line.modifiers).toEqual(sent.modifiers);
          expect(line.allergen_tags).toEqual(sent.allergen_tags);
          for (const key of MARKERS) expect(line[key]).toBe(sent[key]);
          line.extras.forEach((extra: any, j: number) => {
            expect(extra.item_name_snapshot).toBe(sent.extras[j].item_name_snapshot);
            expect(extra.quantity).toBe(sent.extras[j].quantity);
            expect(extra.allergen_tags).toEqual(sent.extras[j].allergen_tags);
            for (const key of MARKERS) expect(extra[key]).toBe(sent.extras[j][key]);
          });
        });
      }
    });

    it('leaves the commands on a legacy ticket exactly as they were', () => {
      deliver(feed);
      const id = scenario('delivered', LEGACY);
      const card = render(stored('active', id), false);
      const advance = card.querySelector('footer button') as HTMLButtonElement;

      expect(advance.textContent?.trim()).toBe('Start');
      expect(advance.disabled).withContext('notices never withhold a command').toBeFalse();
      expect(service.advanceStatus(id, 'preparing')).toBeTrue();
      const put = httpMock.expectOne(`${API}/kitchen/orders/${id}/fulfilment-status/`);
      expect(put.request.method).toBe('PUT');
      expect(put.request.body)
        .withContext('the same command, under the precondition the feed published')
        .toEqual({ action: 'advance', if_revision: 0 });
      put.flush({
        status: 200, outcome: 'applied',
        data: {
          id, fulfilment_revision: 1, order_status: 'pending',
          fulfilment_status: 'preparing', priority: false, served_at: null,
          cancelled_at: null, cancellation_reason: null,
        },
      });
      const after = stored('active', id);
      expect(after.fulfilment_status).toBe('preparing');
      expect(after.fulfilment_revision).toBe(1);
      expect(readLines(render(after, false)).map(l => l.notices))
        .withContext('a command result carries no items, so the cautions survive it')
        .toEqual([LEGACY_PARENT, LEGACY_PARENT]);
    });
  });

  // ── The delivered producer, completed board ─────────────────────────

  describe('a producer that publishes the markers (completed board)', () => {
    const feed = recorded('delivered', 'completed');

    it('renders the same notices in read-only completed mode', () => {
      const raw = deliver(feed);
      expect(JSON.stringify(raw)).toBe(feed.body);

      const captured = render(stored('completed', scenario('delivered', DONE_CAPTURED)), true);
      expect(allNotices(captured)).toEqual(CLEAN);
      expect(readLines(captured)[1].name).toBe('Beef Burger');

      const legacy = readLines(
        render(stored('completed', scenario('delivered', DONE_LEGACY)), true));
      expect(legacy.map(l => l.notices)).toEqual([LEGACY_PARENT, LEGACY_PARENT]);
      expect(legacy[1].extras.map(e => e.notices)).toEqual([LEGACY_EXTRA, LEGACY_EXTRA]);
    });
  });

  // ── An older producer: no markers, no new claim ─────────────────────

  describe('a producer that publishes NO markers (pre-#367 bytes)', () => {
    for (const which of ['active', 'completed'] as const) {
      it(`renders the ${which} board exactly as before: no notices, blank stays blank`, () => {
        const feed = recorded('base', which);
        const raw = deliver(feed);
        expect(JSON.stringify(raw)).toBe(feed.body);

        const list = which === 'active' ? service.activeTickets() : service.completedTickets();
        expect(list.length).toBe(feed.tickets);
        for (const ticket of list) {
          for (const line of ticket.items as any[]) {
            for (const key of MARKERS) {
              expect(key in line).withContext(`${key} stays absent`).toBeFalse();
            }
          }
          const card = render(ticket, which === 'completed');
          expect(allNotices(card))
            .withContext('silence from the server is not a claim either way')
            .toEqual(CLEAN);
        }
        const legacyId = scenario('base', which === 'active' ? LEGACY : DONE_LEGACY);
        const legacy = readLines(render(stored(which, legacyId), which === 'completed'));
        expect(legacy.map(l => l.name))
          .withContext('the old display of a legacy line is kept, blank name included')
          .toEqual(['', '']);
      });
    }
  });

  // ── Derived from the recorded bytes: one marker changed ─────────────

  describe('DERIVED from recorded bytes, exactly one marker changed', () => {
    const feed = recorded('delivered', 'active');
    const capturedId = scenario('delivered', CAPTURED);
    const legacyId = scenario('delivered', LEGACY);

    function burger(raw: any, id: string): any {
      return raw.data.find((t: any) => t.id === id).items[1];
    }

    it('an invalid name marker beside a stored name keeps the name and says unverified',
       () => {
      deliver(feed, raw => { burger(raw, capturedId).item_name_provenance = null; });
      const line = readLines(render(stored('active', capturedId), false))[1];

      expect(line.name).withContext('the stored name is never replaced').toBe('Beef Burger');
      expect(line.notices).toEqual([NAME_UNVERIFIED]);
      expect(line.extras.map(e => e.notices)).toEqual([CLEAN, CLEAN]);
    });

    it('an unknown allergen marker keeps the chips and cautions on them', () => {
      deliver(feed, raw => { burger(raw, capturedId).allergen_tags_provenance = 'unknown'; });
      const line = readLines(render(stored('active', capturedId), false))[1];

      expect(line.text).toContain('Peanuts');
      expect(line.notices).toEqual([ALLERGENS_UNVERIFIED]);
    });

    it('a non-string options marker keeps the options and cautions on them', () => {
      deliver(feed, raw => { burger(raw, capturedId).modifiers_provenance = 42; });
      const line = readLines(render(stored('active', capturedId), false))[1];

      expect(line.text).toContain('Size: Large');
      expect(line.notices).toEqual([OPTIONS_UNVERIFIED]);
    });

    it('an invalid marker on an extra cautions on that extra and nothing else', () => {
      deliver(feed, raw => {
        burger(raw, capturedId).extras[1].allergen_tags_provenance = null;
      });
      const line = readLines(render(stored('active', capturedId), false))[1];

      expect(line.notices).toEqual(CLEAN);
      expect(line.extras[0].notices).toEqual(CLEAN);
      expect(line.extras[1].notices).toEqual([ALLERGENS_UNVERIFIED]);
      expect(line.extras[1].text).toContain('Milk');
    });

    it('a marker that is ABSENT stays silent while its siblings still caution', () => {
      deliver(feed, raw => { delete burger(raw, legacyId).item_name_provenance; });
      const line = readLines(render(stored('active', legacyId), false))[1];

      expect(line.name).withContext('no marker, no claim: the old blank display').toBe('');
      expect(line.notices).toEqual([OPTIONS_UNVERIFIED, ALLERGENS_UNVERIFIED]);
    });

    it('an invalid marker alone never makes the feed unreadable', () => {
      deliver(feed, raw => {
        for (const ticket of raw.data) {
          for (const line of ticket.items) {
            line.item_name_provenance = { snapshot: true };
            for (const extra of line.extras) extra.allergen_tags_provenance = [];
          }
        }
      });
      expect(service.feedUnreadable()).toBeFalse();
      expect(service.activeTickets().length).toBe(feed.tickets);
    });
  });

  // ── The words themselves ────────────────────────────────────────────

  it('never states an assurance in a notice it generates', () => {
    const feeds: RecordedKitchenFeed[] = [
      recorded('delivered', 'active'), recorded('delivered', 'completed'),
    ];
    const seen = new Set<string>();
    for (const feed of feeds) {
      deliver(feed);
      const list = feed.feed === 'active' ? service.activeTickets() : service.completedTickets();
      for (const ticket of list) {
        for (const notice of allNotices(render(ticket, feed.feed === 'completed'))) {
          seen.add(notice);
        }
      }
    }
    expect([...seen].sort())
      .withContext('exactly the approved words reach the screen')
      .toEqual([ALLERGENS_UNVERIFIED, NAME_UNAVAILABLE, OPTIONS_UNVERIFIED].sort());
    for (const notice of seen) {
      expect(notice).not.toMatch(/allergen[- ]?free|no allergens|none flagged|safe|not recorded/i);
    }
  });
});
