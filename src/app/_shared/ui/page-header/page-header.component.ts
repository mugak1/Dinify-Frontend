import { Component, Input } from '@angular/core';

/**
 * The single source of truth for a portal page title. Renders one `<h1>` on the
 * shared page-title look (`text-2xl sm:text-3xl font-bold text-foreground`;
 * Gabarito arrives via the `app-restaurant-mgt h1` selector) plus an optional
 * muted description, with a right-aligned `[actions]` slot for the page's one
 * primary action.
 *
 * Replaces the four competing hand-rolled h1 systems across the portal. Because
 * it still renders an `<h1>` whose text is `{{ title }}`, specs that assert on
 * h1 textContent keep passing.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  template: `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <h1 class="text-2xl sm:text-3xl font-bold text-foreground">{{ title }}</h1>
        @if (description) {
          <p class="text-sm text-muted-foreground">{{ description }}</p>
        }
      </div>
      <div class="shrink-0">
        <ng-content select="[actions]"></ng-content>
      </div>
    </div>
  `,
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() description?: string;
}
