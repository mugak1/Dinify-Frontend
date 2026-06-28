import { Component } from '@angular/core';

/**
 * Diner-facing notice shown when the scanned table already has an order that
 * hasn't yet cleared the kitchen. Surfaces at the top of the menu (heads-up) and
 * at the top of the basket, so a diner understands why they can't place a second
 * order on the same table. Pure/presentational — the ongoing-order decision is
 * made by the caller from the table-scan `current_order.ongoing` flag (or the
 * initiate 400 backstop).
 *
 * Styled as a compact white card with a red icon chip (deliberately lighter than
 * the flat amber allergy notice it sits alongside in the basket).
 */
@Component({
  selector: 'app-ongoing-order-banner',
  standalone: true,
  template: `
    <div class="flex items-start gap-3 rounded-2xl bg-white border border-gray-100 shadow-sm px-4 py-3"
         role="status">
      <span class="flex-shrink-0 grid place-items-center w-8 h-8 rounded-full bg-d-red-soft text-d-red-hover">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             class="w-4 h-4" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </span>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-gray-900">Order in progress</p>
        <p class="text-xs text-gray-500 leading-relaxed mt-0.5">
          This table has an order being prepared. You can order again once it has
          been served — please ask a member of staff if you need help.
        </p>
      </div>
    </div>
  `,
})
export class OngoingOrderBannerComponent {}
