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
});
