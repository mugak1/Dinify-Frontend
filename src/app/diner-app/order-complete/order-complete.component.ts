import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-order-complete',
    templateUrl: './order-complete.component.html',
    styleUrl: './order-complete.component.css',
    standalone: false
})
export class OrderCompleteComponent {
  /** Client-side placeholder reference for display only — NOT a real backend
   *  order id. Generated once per visit, e.g. "DN-4821". */
  readonly orderRef = signal<string>(this.generatePlaceholderRef());

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
  }

  /** Simple client-side reference like "DN-4821" — a display placeholder only. */
  private generatePlaceholderRef(): string {
    return 'DN-' + Math.floor(1000 + Math.random() * 9000);
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
