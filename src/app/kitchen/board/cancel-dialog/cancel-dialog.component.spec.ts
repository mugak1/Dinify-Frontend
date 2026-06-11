import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KitchenTicket } from '../../models/kitchen.models';
import { CancelDialogComponent } from './cancel-dialog.component';

function makeOrder(partial: Partial<KitchenTicket> = {}): KitchenTicket {
  return {
    id: 't1',
    order_number: 42,
    table_label: 'Table 5',
    order_source: 'diner_self_service',
    fulfilment_status: 'preparing',
    priority: false,
    created_at: new Date().toISOString(),
    served_at: null,
    items: [],
    ...partial,
  };
}

describe('CancelDialogComponent', () => {
  let fixture: ComponentFixture<CancelDialogComponent>;
  let component: CancelDialogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CancelDialogComponent] }).compileComponents();
    fixture = TestBed.createComponent(CancelDialogComponent);
    component = fixture.componentInstance;
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function buttons(): HTMLButtonElement[] {
    return Array.from(host().querySelectorAll('button'));
  }
  function buttonByText(text: string): HTMLButtonElement | undefined {
    return buttons().find(b => (b.textContent ?? '').trim().includes(text));
  }

  it('renders nothing when closed', () => {
    component.open = false;
    component.order = makeOrder();
    fixture.detectChanges();
    expect(host().querySelector('[role="dialog"]')).toBeNull();
    expect(buttons().length).toBe(0);
  });

  it('renders nothing when open but there is no order', () => {
    component.open = true;
    component.order = null;
    fixture.detectChanges();
    expect(host().querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the order number, table and five reasons when open', () => {
    component.open = true;
    component.order = makeOrder();
    fixture.detectChanges();

    const text = host().textContent ?? '';
    expect(text).toContain('#042');
    expect(text).toContain('Table 5');
    expect(buttonByText('Customer changed mind')).toBeTruthy();
    expect(buttonByText('Item unavailable')).toBeTruthy();
    expect(buttonByText('Kitchen error')).toBeTruthy();
    expect(buttonByText('Duplicate')).toBeTruthy();
    expect(buttonByText('Other')).toBeTruthy();
  });

  it('emits confirm with the matching backend value when a reason is picked', () => {
    component.open = true;
    component.order = makeOrder();
    fixture.detectChanges();

    const spy = jasmine.createSpy('confirm');
    component.confirm.subscribe(spy);
    buttonByText('Kitchen error')!.click();
    expect(spy).toHaveBeenCalledWith('kitchen_error');
  });

  it('emits closed from the Keep order button', () => {
    component.open = true;
    component.order = makeOrder();
    fixture.detectChanges();

    const spy = jasmine.createSpy('closed');
    component.closed.subscribe(spy);
    buttonByText('Keep order')!.click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits closed when the scrim is clicked', () => {
    component.open = true;
    component.order = makeOrder();
    fixture.detectChanges();

    const spy = jasmine.createSpy('closed');
    component.closed.subscribe(spy);
    (host().querySelector('.kcd-scrim') as HTMLElement).click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits closed on Escape only while open', () => {
    const spy = jasmine.createSpy('closed');
    component.closed.subscribe(spy);

    component.open = false;
    component.onEscape();
    expect(spy).not.toHaveBeenCalled();

    component.open = true;
    component.onEscape();
    expect(spy).toHaveBeenCalled();
  });
});
