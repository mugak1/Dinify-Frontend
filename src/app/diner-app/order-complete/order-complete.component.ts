import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from 'src/app/_services/api.service';

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

  /** Real backend order id forwarded from checkout. Gates the whole review
   *  block: when null (e.g. the placeholder/no-id path) the success screen is
   *  unchanged and no review UI renders. */
  readonly orderId = signal<string | null>(null);

  /** Table id forwarded from checkout, used to route back to the diner's menu. */
  private readonly tableId: string | null;

  // ── Review capture state ───────────────────────────────────────────────────
  readonly stars = [1, 2, 3, 4, 5];

  /** Optional per-dimension ratings. Keys are the exact backend field names so a
   *  rated dimension drops straight into the submit payload. */
  readonly dimensions: { key: string; label: string }[] = [
    { key: 'food_rating', label: 'Food' },
    { key: 'speed_rating', label: 'Speed' },
    { key: 'service_rating', label: 'Service' },
    { key: 'value_rating', label: 'Value' },
    { key: 'cleanliness_rating', label: 'Cleanliness' },
  ];

  /** Required overall rating (1-5); 0 means not yet rated. */
  readonly overall = signal<number>(0);
  /** Optional dimension ratings, keyed by backend field name. */
  readonly dimensionRatings = signal<Record<string, number>>({});
  /** Optional free-text comment. */
  readonly comment = signal<string>('');
  /** True while the submit round-trip is in flight — disables the button. */
  readonly submitting = signal<boolean>(false);
  /** True once the review is accepted — swaps the form for a thank-you. */
  readonly submitted = signal<boolean>(false);

  constructor(private router: Router, private api: ApiService) {
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

    const oid = state['orderId'];
    this.orderId.set(typeof oid === 'string' && oid.trim().length > 0 ? oid : null);
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

  /** Record an optional dimension rating. */
  setDimension(key: string, value: number): void {
    this.dimensionRatings.update((m) => ({ ...m, [key]: value }));
  }

  /** Mirror the comment textarea into the signal. */
  onComment(e: Event): void {
    this.comment.set((e.target as HTMLTextAreaElement).value);
  }

  /** Submit the review. Overall is required; every dimension and the comment is
   *  optional and omitted entirely when unset. On success we show a thank-you;
   *  on any error we simply re-enable the button — the global toast (raised by
   *  the HTTP error interceptor) already surfaces the backend message, so the
   *  diner can retry or just leave. */
  submitReview(): void {
    const orderId = this.orderId();
    if (!orderId || this.overall() < 1 || this.submitting()) return;
    this.submitting.set(true);

    const ratings = this.dimensionRatings();
    const comment = this.comment().trim();
    const payload: Record<string, unknown> = {
      order: orderId,
      overall_rating: this.overall(),
    };
    for (const dim of this.dimensions) {
      const v = ratings[dim.key];
      if (v >= 1 && v <= 5) {
        payload[dim.key] = v; // omit unrated dimensions entirely
      }
    }
    if (comment) {
      payload['comment'] = comment; // omit an empty comment
    }

    this.api.postPatch('reviews/submit/', payload, 'post').subscribe(
      () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      () => {
        // Errors surface via the global toast; just re-enable the button.
        this.submitting.set(false);
      },
    );
  }
}
