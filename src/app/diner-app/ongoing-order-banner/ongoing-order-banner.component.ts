import { Component, Input } from '@angular/core';

/**
 * Diner-facing notice shown when the scanned table already has an order that
 * hasn't yet cleared the kitchen. Surfaces on the menu (heads-up) and in the
 * basket (beside the disabled checkout), so a diner understands why they can't
 * place a second order on the same table. Pure/presentational — the
 * ongoing-order decision is made by the caller from the table-scan
 * `current_order.ongoing` flag (or the initiate 400 backstop).
 */
@Component({
  selector: 'app-ongoing-order-banner',
  standalone: true,
  template: `
    <div class="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-900"
         role="status">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
           class="flex-shrink-0 mt-px text-amber-600" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <p class="text-xs leading-relaxed">{{ message }}</p>
    </div>
  `,
})
export class OngoingOrderBannerComponent {
  /** Override copy; defaults to the standard ongoing-order explanation. */
  @Input() message =
    "This table already has an order in progress. You'll be able to place a new " +
    'order once it has been served — please ask a member of staff if you need help.';
}
