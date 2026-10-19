import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KitchenTicket } from '../../models/kitchen.models';
import { OVERDUE_MS, WARNING_MS } from '../../services/kitchen-logic';
import { TicketCardComponent } from './ticket-card.component';

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
    items: [
      {
        item_name_snapshot: 'Pad Thai',
        quantity: 2,
        modifiers: ['Spice: Medium', 'No peanuts'],
        allergen_tags: [{ name: 'Nuts', icon: 'nut', colour: 'orange' }],
        extras: [
          {
            item_name_snapshot: 'Add prawns',
            quantity: 1,
            modifiers: ['Extra spicy'],
            allergen_tags: [{ name: 'Shellfish', icon: 'shell', colour: 'rose' }],
          },
        ],
      },
    ],
    ...partial,
  };
}

describe('TicketCardComponent', () => {
  let fixture: ComponentFixture<TicketCardComponent>;
  let component: TicketCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TicketCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(TicketCardComponent);
    component = fixture.componentInstance;
  });

  it('renders order number, table, items, modifiers and allergens', () => {
    component.ticket = makeTicket();
    component.now = Date.now();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('#007');
    expect(text).toContain('Table 9');
    expect(text).toContain('Pad Thai');
    expect(text).toContain('Spice: Medium');
    expect(text).toContain('Nuts');
    // server_assisted indicator
    expect(text).toContain('Server');
  });

  it('renders extras (add-ons) with their modifiers and allergens under the parent line', () => {
    component.ticket = makeTicket();
    component.now = Date.now();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Add prawns');
    expect(text).toContain('Extra spicy');
    expect(text).toContain('Shellfish');
  });

  it('applies the overdue escalation class past the threshold', () => {
    component.ticket = makeTicket({ created_at: new Date(Date.now() - OVERDUE_MS - 1000).toISOString() });
    component.now = Date.now();
    fixture.detectChanges();

    expect(component.escalation).toBe('overdue');
    const card = (fixture.nativeElement as HTMLElement).querySelector('article')!;
    expect(card.classList).toContain('kitchen-overdue');
  });

  describe('card redesign — typed modifiers, quantity badges, header band', () => {
    function itemSpan(text: string): HTMLElement | undefined {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'))
        .find((s) => (s.textContent ?? '').includes(text));
    }
    function qtySpan(text: string): HTMLElement | undefined {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'))
        .find((s) => (s.textContent ?? '').trim() === text);
    }

    it('renders an omission modifier in red with a ban icon', () => {
      component.ticket = makeTicket({
        items: [{ item_name_snapshot: 'Burger', quantity: 1, modifiers: ['No pickles'], allergen_tags: [], extras: [] }],
      });
      component.now = Date.now();
      fixture.detectChanges();

      const span = itemSpan('No pickles');
      expect(span).toBeTruthy();
      expect(span!.className).toContain('text-red-600');
      expect(span!.querySelector('svg')).toBeTruthy();
    });

    it('renders an addition modifier in blue with a plus icon', () => {
      component.ticket = makeTicket({
        items: [{ item_name_snapshot: 'Burger', quantity: 1, modifiers: ['Extra cheese'], allergen_tags: [], extras: [] }],
      });
      component.now = Date.now();
      fixture.detectChanges();

      const span = itemSpan('Extra cheese');
      expect(span).toBeTruthy();
      expect(span!.className).toContain('text-blue-600');
      expect(span!.querySelector('svg')).toBeTruthy();
    });

    it('renders a doneness term as a purple prep chip', () => {
      component.ticket = makeTicket({
        items: [{ item_name_snapshot: 'Steak', quantity: 1, modifiers: ['Medium rare'], allergen_tags: [], extras: [] }],
      });
      component.now = Date.now();
      fixture.detectChanges();

      const span = itemSpan('Medium rare');
      expect(span).toBeTruthy();
      expect(span!.className).toContain('bg-purple-100');
    });

    it('renders a filled badge for an item quantity greater than 1', () => {
      component.ticket = makeTicket({
        items: [{ item_name_snapshot: 'Fries', quantity: 2, modifiers: [], allergen_tags: [], extras: [] }],
      });
      component.now = Date.now();
      fixture.detectChanges();

      const qty = qtySpan('2×');
      expect(qty).toBeTruthy();
      expect(qty!.className).toContain('bg-gray-900');
    });

    it('keeps an item quantity of 1 quiet (de-emphasised, no badge)', () => {
      component.ticket = makeTicket({
        items: [{ item_name_snapshot: 'Fries', quantity: 1, modifiers: [], allergen_tags: [], extras: [] }],
      });
      component.now = Date.now();
      fixture.detectChanges();

      const qty = qtySpan('1×');
      expect(qty).toBeTruthy();
      expect(qty!.className).toContain('text-gray-500');
      expect(qty!.className).not.toContain('bg-gray-900');
    });

    it('tints the header amber on warning while the card body stays white', () => {
      component.ticket = makeTicket({ created_at: new Date(Date.now() - WARNING_MS - 60_000).toISOString() });
      component.now = Date.now();
      fixture.detectChanges();

      expect(component.escalation).toBe('warning');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('header')!.className).toContain('bg-amber-50');
      const article = el.querySelector('article')!;
      expect(article.className).toContain('bg-white');
      expect(article.className).not.toContain('bg-amber-50');
    });

    it('tints the header red on overdue, keeps the body white, and glows via kitchen-overdue', () => {
      component.ticket = makeTicket({ created_at: new Date(Date.now() - OVERDUE_MS - 1000).toISOString() });
      component.now = Date.now();
      fixture.detectChanges();

      expect(component.escalation).toBe('overdue');
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('header')!.className).toContain('bg-red-100');
      const article = el.querySelector('article')!;
      expect(article.className).toContain('bg-white');
      expect(article.className).toContain('kitchen-overdue');
      expect(article.className).not.toContain('bg-red-100');
    });
  });

  describe('escalation label (colour-independent urgency)', () => {
    function badge(): HTMLElement | undefined {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'))
        .find((s) => ['Due soon', 'Overdue'].includes((s.textContent ?? '').trim()));
    }

    it('names the warning tier "Due soon" (not colour alone)', () => {
      component.ticket = makeTicket({ created_at: new Date(Date.now() - WARNING_MS - 60_000).toISOString() });
      component.now = Date.now();
      fixture.detectChanges();

      expect(component.escalation).toBe('warning');
      const chip = badge();
      expect(chip).toBeTruthy();
      expect(chip!.textContent!.trim()).toBe('Due soon');
      expect(chip!.className).toContain('bg-amber-100');
    });

    it('names the overdue tier "Overdue" (not colour/pulse alone)', () => {
      component.ticket = makeTicket({ created_at: new Date(Date.now() - OVERDUE_MS - 1000).toISOString() });
      component.now = Date.now();
      fixture.detectChanges();

      expect(component.escalation).toBe('overdue');
      const chip = badge();
      expect(chip).toBeTruthy();
      expect(chip!.textContent!.trim()).toBe('Overdue');
      expect(chip!.className).toContain('bg-red-600');
    });

    it('shows no escalation chip while on time', () => {
      component.ticket = makeTicket({ created_at: new Date().toISOString() });
      component.now = Date.now();
      fixture.detectChanges();

      expect(component.escalation).toBe('normal');
      expect(badge()).toBeFalsy();
    });
  });

  it('shows a recall control for a ready ticket and not for a new one', () => {
    component.ticket = makeTicket({ fulfilment_status: 'ready' });
    component.now = Date.now();
    fixture.detectChanges();
    expect(component.canRecall).toBe(true);

    component.ticket = makeTicket({ fulfilment_status: 'new' });
    fixture.detectChanges();
    expect(component.canRecall).toBe(false);
  });

  describe('cancel control (canCancel gate)', () => {
    function canCancel(status: KitchenTicket['fulfilment_status'], isManager: boolean): boolean {
      component.ticket = makeTicket({ fulfilment_status: status });
      component.isManager = isManager;
      return component.canCancel;
    }

    it("allows any kitchen user to void a 'new' ticket", () => {
      expect(canCancel('new', false)).toBe(true);
      expect(canCancel('new', true)).toBe(true);
    });

    it("gates 'preparing'/'ready' cancels to managers only", () => {
      expect(canCancel('preparing', false)).toBe(false);
      expect(canCancel('ready', false)).toBe(false);
      expect(canCancel('preparing', true)).toBe(true);
      expect(canCancel('ready', true)).toBe(true);
    });

    it("never allows cancelling a 'served' ticket (recall first)", () => {
      expect(canCancel('served', false)).toBe(false);
      expect(canCancel('served', true)).toBe(false);
    });

    function cancelButton(): HTMLButtonElement | null {
      return (fixture.nativeElement as HTMLElement)
        .querySelector('button[aria-label="Cancel order"]');
    }

    it('renders the cancel button when canCancel and emits cancelRequested on click', () => {
      component.ticket = makeTicket({ fulfilment_status: 'new' });
      component.now = Date.now();
      fixture.detectChanges();

      const spy = jasmine.createSpy('cancelRequested');
      component.cancelRequested.subscribe(spy);

      const btn = cancelButton();
      expect(btn).toBeTruthy();
      btn!.click();
      expect(spy).toHaveBeenCalledWith(component.ticket);
    });

    it('hides the cancel button when canCancel is false', () => {
      component.ticket = makeTicket({ fulfilment_status: 'preparing' });
      component.isManager = false;
      component.now = Date.now();
      fixture.detectChanges();
      expect(cancelButton()).toBeNull();
    });
  });

  describe('completed (read-only) mode', () => {
    function setup(partial: Partial<KitchenTicket> = {}): void {
      component.ticket = makeTicket({
        fulfilment_status: 'served',
        served_at: new Date(Date.now() - 3 * 60_000).toISOString(),
        ...partial,
      });
      component.now = Date.now();
      component.completed = true;
      fixture.detectChanges();
    }

    it('hides the advance, cancel and priority controls, showing only Recall', () => {
      setup();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('button[aria-label="Cancel order"]')).toBeNull();
      expect(el.querySelector('button[aria-label="Toggle priority"]')).toBeNull();

      const footerButtons = el.querySelectorAll('footer button');
      expect(footerButtons.length).toBe(1);
      expect(footerButtons[0].textContent).toContain('Recall');
    });

    it('emits recall when the Recall button is clicked', () => {
      setup();
      const spy = jasmine.createSpy('recall');
      component.recall.subscribe(spy);

      const recallBtn = (fixture.nativeElement as HTMLElement)
        .querySelector('footer button') as HTMLButtonElement;
      recallBtn.click();
      expect(spy).toHaveBeenCalledWith(component.ticket);
    });

    it('shows a muted "served {relative}" line in place of the live age', () => {
      setup();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('served 3m ago');
    });

    it('keeps the header neutral even when the underlying age would be overdue', () => {
      // served_at is null AND created long ago — without the completed guard this
      // would tint the header red. Completed mode must stay neutral.
      setup({ created_at: new Date(Date.now() - OVERDUE_MS - 1000).toISOString(), served_at: null });
      const header = (fixture.nativeElement as HTMLElement).querySelector('header')!;
      expect(header.className).not.toContain('bg-red-100');
      expect(header.className).not.toContain('bg-amber-50');
    });
  });

  // ── D05: the card tells the truth about an unresolved command ────────────
  describe('command state', () => {
    function render(ticket: Partial<KitchenTicket>, over: Partial<TicketCardComponent> = {}) {
      component.ticket = makeTicket(ticket);
      component.now = Date.now();
      component.canCommand = true;
      Object.assign(component, over);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    it('shows what is happening and makes the controls inert while pending', () => {
      const el = render({ fulfilment_status: 'new', fulfilment_revision: 0 }, {
        operation: {
          orderId: 't1', phase: 'pending', label: 'Moving to preparing',
          ifRevision: 0,
        },
      });
      expect(el.textContent).toContain('Moving to preparing');
      expect(component.commandsEnabled).toBeFalse();
      const advance = el.querySelector('footer button') as HTMLButtonElement;
      expect(advance.disabled).toBeTrue();
    });

    it('shows the SERVER message on a conflict and keeps the card', () => {
      const el = render({ fulfilment_status: 'new', fulfilment_revision: 0 }, {
        operation: {
          orderId: 't1', phase: 'conflict', label: 'Moving to preparing',
          ifRevision: 0, reason: 'order_cancelled',
          message: 'This order has been cancelled.',
        },
      });
      expect(el.textContent).toContain('This order has been cancelled.');
      // The ticket is still rendered — it is not silently removed.
      expect(el.textContent).toContain('Pad Thai');
      expect(el.querySelector('[role="alert"]')).toBeTruthy();
    });

    it('says the outcome is UNKNOWN rather than claiming a failure', () => {
      const el = render({ fulfilment_status: 'new', fulfilment_revision: 0 }, {
        operation: {
          orderId: 't1', phase: 'unknown', label: 'Cancelling', ifRevision: 0,
          message: 'We could not confirm this with the kitchen server. '
                 + 'The board will show the current state shortly.',
        },
      });
      expect(el.textContent).toContain('could not confirm');
      // It must NOT say the command failed or was undone.
      expect(el.textContent).not.toContain('failed');
    });

    it('withholds every control when the server declares no protocol', () => {
      const el = render(
        { fulfilment_status: 'preparing', fulfilment_revision: 0 },
        { canCommand: false, isManager: true });
      expect(component.commandsEnabled).toBeFalse();
      expect(component.canCancel).toBeFalse();
      expect(component.canRecall).toBeFalse();
      const advance = el.querySelector('footer button') as HTMLButtonElement;
      expect(advance.disabled).toBeTrue();
    });

    it('gates the COMPLETED recall button on the window, which it never did', () => {
      // REGRESSION: this button rendered unconditionally and fired the request
      // at any age, so the ten-minute rule was dead in the shipped UI.
      const stale = render({
        fulfilment_status: 'served', fulfilment_revision: 0,
        served_at: new Date(Date.now() - 45 * 60_000).toISOString(),
      }, { completed: true });
      const button = stale.querySelector('footer button') as HTMLButtonElement;
      expect(component.canRecall).toBeFalse();
      expect(button.disabled).toBeTrue();
    });

    it('still offers recall inside the window', () => {
      const fresh = render({
        fulfilment_status: 'served', fulfilment_revision: 0,
        served_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      }, { completed: true });
      const button = fresh.querySelector('footer button') as HTMLButtonElement;
      expect(component.canRecall).toBeTrue();
      expect(button.disabled).toBeFalse();
    });

    it('emits acknowledge when a notice is dismissed', () => {
      const el = render({ fulfilment_revision: 0 }, {
        operation: {
          orderId: 't1', phase: 'conflict', label: 'x', ifRevision: 0,
          message: 'Something changed.',
        },
      });
      const spy = jasmine.createSpy('acknowledge');
      component.acknowledge.subscribe(spy);
      (el.querySelector('[aria-label="Dismiss this notice"]') as HTMLButtonElement).click();
      expect(spy).toHaveBeenCalled();
    });

    it('has no notice at all when nothing is unresolved', () => {
      const el = render({ fulfilment_revision: 0 });
      expect(component.operationNotice).toBeNull();
      expect(el.querySelector('[role="alert"]')).toBeNull();
      expect(component.commandsEnabled).toBeTrue();
    });
  });

  // ── D12 B3: each line says what the server can and cannot vouch for ──────
  //
  // `missing` means the server cannot establish that a stored value is what
  // was captured when the line was ordered. It is not proof that nothing was
  // recorded, and a captured EMPTY allergen list is not an allergen-free claim.
  // The notices are the application's own words; whatever the merchant wrote
  // is shown as it always was.
  describe('historical line evidence (D12 B3)', () => {
    const NAME_UNAVAILABLE = 'Item name unavailable';
    const NAME_UNVERIFIED = 'Item name unverified';
    const OPTIONS = 'Options unverified — check before preparing';
    const ALLERGENS = 'Allergen information unverified — check before preparing';
    const FORBIDDEN = /allergen[- ]?free|no allergens|none flagged|safe|not recorded/i;

    const SNAP = {
      item_name_provenance: 'snapshot', modifiers_provenance: 'snapshot',
      allergen_tags_provenance: 'snapshot',
    };
    const MISS = {
      item_name_provenance: 'missing', modifiers_provenance: 'missing',
      allergen_tags_provenance: 'missing',
    };

    function line(over: any = {}): any {
      return {
        item_name_snapshot: 'Beef Burger', quantity: 2, modifiers: ['Size: Large'],
        allergen_tags: [{ name: 'Peanuts', icon: 'nut', colour: 'red' }], extras: [],
        ...over,
      };
    }
    function extra(over: any = {}): any {
      return {
        item_name_snapshot: 'Cheese Slice', quantity: 2, modifiers: [],
        allergen_tags: [{ name: 'Milk', icon: 'milk', colour: 'amber' }], ...over,
      };
    }

    function render(items: any[], over: Partial<KitchenTicket> = {}): HTMLElement {
      fixture.componentRef.setInput(
        'ticket', makeTicket({ fulfilment_status: 'new', fulfilment_revision: 0, items, ...over }));
      fixture.componentRef.setInput('now', Date.now());
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    function parentLine(el: HTMLElement, i = 0): HTMLElement {
      return el.querySelectorAll<HTMLElement>('article > div.overflow-y-auto > div')[i];
    }
    function extraLine(el: HTMLElement, i = 0, parent = 0): HTMLElement {
      return parentLine(el, parent)
        .querySelectorAll<HTMLElement>(':scope > div.space-y-1 > div')[i];
    }
    function notices(el: HTMLElement, which: 'parent' | 'extra'): string[] {
      return Array.from(el.querySelectorAll<HTMLElement>('[data-testid="line-evidence"]'))
        .filter(n => n.getAttribute('data-line') === which)
        .map(n => (n.textContent ?? '').trim());
    }
    function nameSlot(el: HTMLElement): string {
      return (el.querySelector(':scope > div.flex > span:nth-of-type(2)')?.textContent ?? '')
        .trim();
    }

    it('keeps the old display when the server sent no markers, blank name included', () => {
      const el = render([line({ item_name_snapshot: '', modifiers: [], allergen_tags: [] })]);
      expect(notices(el, 'parent')).toEqual([]);
      expect(nameSlot(parentLine(el))).toBe('');
    });

    it('keeps the existing display for captured values', () => {
      const el = render([line({ ...SNAP, extras: [extra({ ...SNAP })] })]);
      expect(notices(el, 'parent')).toEqual([]);
      expect(notices(el, 'extra')).toEqual([]);
      const text = el.textContent ?? '';
      for (const shown of ['Beef Burger', 'Size: Large', 'Peanuts', 'Cheese Slice', 'Milk']) {
        expect(text).toContain(shown);
      }
    });

    it('adds nothing to a captured-EMPTY line: no notice and no assurance', () => {
      const el = render([line({ ...SNAP, item_name_snapshot: 'Pasta', modifiers: [],
                                allergen_tags: [] })]);
      expect(notices(el, 'parent')).toEqual([]);
      expect(el.textContent ?? '').not.toMatch(/allergen/i);
    });

    it('calls an empty name it cannot vouch for unavailable rather than leaving it blank',
       () => {
      const el = render([line({ item_name_snapshot: '', item_name_provenance: 'missing' })]);
      expect(nameSlot(parentLine(el))).toBe(NAME_UNAVAILABLE);
      expect(notices(el, 'parent')).toEqual([NAME_UNAVAILABLE]);
    });

    it('keeps a stored name it cannot vouch for and says it is unverified', () => {
      const el = render([line({ item_name_provenance: 'missing' })]);
      expect(nameSlot(parentLine(el))).toBe('Beef Burger');
      expect(notices(el, 'parent')).toEqual([NAME_UNVERIFIED]);
    });

    it('keeps stored options it cannot vouch for and cautions on them', () => {
      const el = render([line({ modifiers_provenance: 'missing' })]);
      expect(parentLine(el).textContent).toContain('Size: Large');
      expect(notices(el, 'parent')).toEqual([OPTIONS]);
    });

    it('cautions on options even when none are stored', () => {
      const el = render([line({ modifiers: [], modifiers_provenance: 'missing' })]);
      expect(notices(el, 'parent')).toEqual([OPTIONS]);
    });

    it('keeps stored allergen chips it cannot vouch for and cautions on them', () => {
      const el = render([line({ allergen_tags_provenance: 'missing' })]);
      expect(parentLine(el).textContent).toContain('Peanuts');
      expect(notices(el, 'parent')).toEqual([ALLERGENS]);
    });

    it('cautions on allergens even when none are stored, and promises nothing', () => {
      const el = render([line({ allergen_tags: [], allergen_tags_provenance: 'missing' })]);
      expect(notices(el, 'parent')).toEqual([ALLERGENS]);
      for (const n of notices(el, 'parent')) expect(n).not.toMatch(FORBIDDEN);
    });

    it('orders a fully unverified line name, options, allergens', () => {
      const el = render([line({ ...MISS })]);
      expect(notices(el, 'parent')).toEqual([NAME_UNVERIFIED, OPTIONS, ALLERGENS]);
    });

    it('judges an extra on its own markers, and gives it no options notice', () => {
      const el = render([line({ ...SNAP, extras: [
        extra({ ...MISS, item_name_snapshot: '' }),
        extra({ ...SNAP, item_name_snapshot: 'Bacon Strip', allergen_tags: [] }),
      ] })]);
      expect(notices(parentLine(el), 'parent')).toEqual([]);
      expect(nameSlot(extraLine(el, 0))).toBe(NAME_UNAVAILABLE);
      expect(notices(extraLine(el, 0), 'extra')).toEqual([NAME_UNAVAILABLE, ALLERGENS]);
      expect(notices(extraLine(el, 1), 'extra')).toEqual([]);
    });

    it('does not let a parent caution reach its extras', () => {
      const el = render([line({ ...MISS, extras: [extra({ ...SNAP })] })]);
      expect(notices(parentLine(el), 'parent')).toEqual([NAME_UNVERIFIED, OPTIONS, ALLERGENS]);
      expect(notices(extraLine(el, 0), 'extra')).toEqual([]);
    });

    it("still renders an extra's stored options, as it always did", () => {
      const el = render([line({ ...SNAP, extras: [
        extra({ ...MISS, modifiers: ['Extra crispy'] }),
      ] })]);
      expect(extraLine(el, 0).textContent).toContain('Extra crispy');
      expect(notices(extraLine(el, 0), 'extra')).toEqual([NAME_UNVERIFIED, ALLERGENS]);
    });

    it('treats an un-normalised marker reaching the card as unverified, never as captured',
       () => {
      const el = render([line({ item_name_provenance: null as any,
                                allergen_tags_provenance: 'garbage' as any })]);
      expect(notices(el, 'parent')).toEqual([NAME_UNVERIFIED, ALLERGENS]);
    });

    it('shows merchant-authored words verbatim; only its own notices are policed', () => {
      const el = render([line({ ...MISS, item_name_snapshot: 'Allergen-free salad',
                                modifiers: ['No allergens'] })]);
      const text = el.textContent ?? '';
      expect(text).withContext('the stored name is the merchant\'s, not ours')
        .toContain('Allergen-free salad');
      expect(text).toContain('No allergens');
      const ours = notices(el, 'parent');
      expect(ours).toEqual([NAME_UNVERIFIED, OPTIONS, ALLERGENS]);
      for (const n of ours) expect(n).not.toMatch(FORBIDDEN);
    });

    it('never withholds a command because of a notice', () => {
      const el = render([line({ ...MISS, extras: [extra({ ...MISS })] })]);
      expect(component.commandsEnabled).toBeTrue();
      expect(component.canCancel).toBeTrue();
      const advance = el.querySelector('footer button') as HTMLButtonElement;
      expect(advance.disabled).toBeFalse();
      expect(advance.textContent?.trim()).toBe('Start');
    });
  });
});
