import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KitchenTicket } from '../../models/kitchen.models';
import { OVERDUE_MS } from '../../services/kitchen-logic';
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
