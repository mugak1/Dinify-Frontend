import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TableDetailsDrawerComponent } from './table-details-drawer.component';
import { FloorRoundDetail, FloorTable, FloorTableDetail } from '../../models/floor.models';

/**
 * The table drawer on its own (Step 2). Presentational: inputs in, outputs out.
 *
 * It replaces the D14 B1 specs on `handlePrintBill`: Print bill is not a Step 2
 * control and is gone with the code that wrote the bill document. What D14 B1
 * protected still holds and is pinned here — every server-supplied label (table,
 * item, extra, modifier, note, sold-out item) renders as TEXT, never as markup — and
 * the drawer can no longer open a window at all.
 */
describe('TableDetailsDrawerComponent (Step 2)', () => {
  const MARKER = '<dinify-probe data-d14="x">m</dinify-probe>';
  let fixture: ComponentFixture<TableDetailsDrawerComponent>;

  function round(over: Partial<FloorRoundDetail> = {}): FloorRoundDetail {
    return {
      orderId: 'o-1',
      roundNumber: 1,
      state: 'held',
      source: 'diner',
      acceptedAt: '2026-11-03T18:58:00+03:00',
      heldSince: '2026-11-03T18:58:00+03:00',
      releasedAt: null,
      stale: false,
      fulfilmentStatus: 'new',
      itemCount: 2,
      value: '17000.00',
      items: [{ name: 'Rolex', quantity: 2, extras: [], modifiers: [], note: null }],
      cannotBeMade: null,
      ...over,
    };
  }

  function detail(rounds: FloorRoundDetail[], over: Partial<FloorTableDetail> = {}): FloorTableDetail {
    return {
      id: 't-2', number: 2, displayName: 'T2', areaId: null, status: 'seated', occupied: true,
      needsStaff: rounds.some(r => r.state === 'held'),
      visit: { id: 'v', openedAt: '2026-11-03T18:50:00+03:00', payment: 'unknown' },
      rounds,
      ...over,
    };
  }

  function render(d: FloorTableDetail, state: 'ready' | 'loading' = 'ready'): HTMLElement {
    TestBed.configureTestingModule({ imports: [TableDetailsDrawerComponent] });
    fixture = TestBed.createComponent(TableDetailsDrawerComponent);
    const c = fixture.componentInstance;
    const { rounds, ...shell } = d;
    c.isOpen = true;
    c.table = { ...shell, rounds: rounds.map(({ items: _i, cannotBeMade: _c, ...r }) => r) } as FloorTable;
    c.detail = d;
    c.detailState = state;
    c.serverNowMs = Date.parse('2026-11-03T19:02:00+03:00');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders every server-supplied label as text, never markup (D14 B1, carried over)', () => {
    const el = render(
      detail(
        [round({
          items: [{ name: MARKER, quantity: 1, extras: [{ name: MARKER, quantity: 1 }], modifiers: [MARKER], note: MARKER }],
          cannotBeMade: { reason: 'item_sold_out', itemName: MARKER },
        })],
        { displayName: MARKER },
      ),
    );
    expect(el.querySelector('dinify-probe')).toBeNull();
    expect((el.textContent ?? '').split(MARKER).length - 1).toBe(6);
  });

  it('never opens a window, whatever is pressed', () => {
    const opened = spyOn(window, 'open');
    const el = render(detail([round()]));
    for (const b of Array.from(el.querySelectorAll<HTMLButtonElement>('button'))) b.click();
    fixture.detectChanges();
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="decline-confirm"]'))) b.click();
    expect(opened).not.toHaveBeenCalled();
  });

  it('Confirm is offered only once the items have loaded — staff confirm what they have seen', () => {
    const el = render(detail([round()]), 'loading');
    expect(el.querySelector('[data-testid="confirm-round"]')).toBeNull();
    expect(el.textContent).toContain('loading items…');
  });

  it('Confirm emits the round; Decline asks first and emits only on "Decline order"', () => {
    const el = render(detail([round()]));
    const c = fixture.componentInstance;
    const confirmed: string[] = [];
    const declined: string[] = [];
    c.confirmRound.subscribe(id => confirmed.push(id));
    c.declineRound.subscribe(id => declined.push(id));

    el.querySelector<HTMLButtonElement>('[data-testid="confirm-round"]')!.click();
    expect(confirmed).toEqual(['o-1']);

    el.querySelector<HTMLButtonElement>('[data-testid="decline-round"]')!.click();
    fixture.detectChanges();
    expect(declined).toEqual([]);
    expect(el.textContent).toContain('Decline this order?');
    expect(el.textContent).toContain('It will not be sent to the kitchen.');
    el.querySelector<HTMLButtonElement>('[data-testid="decline-confirm"]')!.click();
    expect(declined).toEqual(['o-1']);
  });

  it('a round that cannot be made: destructive badge, Confirm disabled and inert', () => {
    const el = render(detail([round({ cannotBeMade: { reason: 'item_sold_out', itemName: 'Rolex' } })]));
    const confirm = el.querySelector<HTMLButtonElement>('[data-testid="confirm-round"]')!;
    expect(confirm.disabled).toBeTrue();
    const emitted: string[] = [];
    fixture.componentInstance.confirmRound.subscribe(id => emitted.push(id));
    fixture.componentInstance.onConfirm({ round: round(), detail: round({ cannotBeMade: { reason: 'x', itemName: 'Rolex' } }) });
    expect(emitted).toEqual([]);
    expect(el.querySelector('[data-testid="cannot-be-made"]')?.textContent?.trim()).toBe('Cannot be made — Rolex');
  });

  it('a released round has no Confirm or Decline', () => {
    const el = render(detail([round({ state: 'released', heldSince: null, releasedAt: '2026-11-03T19:00:00+03:00' })]));
    expect(el.querySelector('[data-testid="confirm-round"]')).toBeNull();
    expect(el.querySelector('[data-testid="decline-round"]')).toBeNull();
  });

  it('the status action for the current status is disabled; the others emit', () => {
    const el = render(detail([], { status: 'dirty', occupied: false, needsStaff: false, visit: null }));
    const emitted: string[] = [];
    fixture.componentInstance.setStatus.subscribe(s => emitted.push(s));
    const action = (s: string) => el.querySelector<HTMLButtonElement>(`[data-status="${s}"]`)!;
    expect(action('dirty').disabled).toBeTrue();
    action('available').click();
    action('out_of_service').click();
    expect(emitted).toEqual(['available', 'out_of_service']);
  });
});
