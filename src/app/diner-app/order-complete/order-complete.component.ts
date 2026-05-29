import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-order-complete',
    templateUrl: './order-complete.component.html',
    styleUrl: './order-complete.component.css',
    standalone: false
})
export class OrderCompleteComponent {
  /** Order reference forwarded from checkout via navigation state; shown only
   *  when present. The placeholder checkout sends no reference (row hidden); the
   *  real flow can forward a backend order id here. */
  readonly orderRef = signal<string | null>(null);

  /** Table number forwarded from checkout via router navigation state. Null when
   *  the diner has no table context, in which case the Table row is omitted. */
  readonly tableNumber = signal<number | null>(null);

  /** Table id forwarded from checkout, used to route back to the diner's menu. */
  private readonly tableId: string | null;

  constructor(private router: Router) {
    // Checkout forwards the table via navigation state right before it clears
    // sessionStorage, so read it from the current navigation (or history.state).
    const state =
      (this.router.getCurrentNavigation()?.extras?.state as Record<string, unknown> | undefined) ??
      (history.state as Record<string, unknown> | null) ??
      {};

    const n = state['tableNumber'];
    this.tableNumber.set(typeof n === 'number' && Number.isFinite(n) ? n : null);

    const id = state['tableId'];
    this.tableId = typeof id === 'string' && id.length > 0 ? id : null;

    const ref = state['orderRef'];
    this.orderRef.set(typeof ref === 'string' && ref.trim().length > 0 ? ref : null);
  }

  /** Returns the diner to the menu. With a forwarded table id we route through
   *  the scan path (re-initialises restaurant/table state); otherwise fall back
   *  to the generic menu route. */
  backToMenu(): void {
    if (this.tableId) {
      this.router.navigate(['/diner', 'h', this.tableId]);
    } else {
      this.router.navigate(['/diner', 'menu']);
    }
  }
}
