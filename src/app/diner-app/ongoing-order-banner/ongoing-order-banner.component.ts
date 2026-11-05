import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MenuNavStateService } from '../menu/menu-nav-state.service';

/**
 * Diner-facing notice shown when the scanned table already has an order that
 * hasn't yet cleared the kitchen. Surfaces at the top of the menu (heads-up) and
 * at the top of the basket, so a diner understands why they can't place a second
 * order on the same table. Pure/presentational — the ongoing-order decision is
 * made by the caller from the table-scan `current_order.ongoing` flag (or the
 * initiate 400 backstop).
 *
 * Styled as a compact white card with a red icon chip.
 *
 * STEP 2 — A HELD ROUND IS NOT "BEING PREPARED". At a pay-after restaurant the
 * table's ongoing order can be a round held for staff to confirm, which the
 * kitchen does not see yet. When the table scan says so (`current_order.held`,
 * read once by the diner shell into `tableOngoingOrderHeld`) the banner says the
 * order is waiting for staff instead. Read from the shared signal rather than an
 * input so both hosts (menu and basket) follow it without either template
 * changing. Against an older backend the flag is false and the banner renders
 * exactly as before.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
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
        @if (held()) {
          <p class="text-sm font-semibold text-gray-900">Order waiting</p>
          <p class="text-xs text-gray-500 leading-relaxed mt-0.5">
            This table has an order waiting for staff to confirm it. Please ask a
            member of staff if you need help.
          </p>
        } @else {
        <p class="text-sm font-semibold text-gray-900">Order in progress</p>
        <p class="text-xs text-gray-500 leading-relaxed mt-0.5">
          This table has an order being prepared. You can order again once it has
          been served — please ask a member of staff if you need help.
        </p>
        }
      </div>
    </div>
  `,
})
export class OngoingOrderBannerComponent {
  /** True only when the table scan explicitly said the ongoing order is held. */
  readonly held = inject(MenuNavStateService).tableOngoingOrderHeld;
}
