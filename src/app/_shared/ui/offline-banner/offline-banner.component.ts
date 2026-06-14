import { Component, inject } from '@angular/core';
import { ConnectivityService } from '../../../_services/connectivity.service';

/**
 * Persistent "you're offline" banner for the back-office shells (restaurant
 * portal + Dinify admin). Mirrors the diner OfflineStripComponent's self-gating
 * pattern, but renders as an in-flow full-width amber bar at the top of the
 * shell's content area (not sticky): while offline it pushes the shell content
 * down and stays put until reconnect; while online it renders nothing.
 *
 * Amber (a *status*, not alarm-red). Offline is reported by the browser
 * (`navigator.onLine` via ConnectivityService), independent of any single
 * failed request, so it appears the instant the connection drops and clears on
 * reconnect. The host is `display: contents`, so when hidden it adds nothing to
 * the shell's flex column.
 */
@Component({
  selector: 'app-offline-banner',
  standalone: true,
  template: `
    @if (connectivity.isOffline()) {
      <div
        class="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-center
               border-b border-amber-200 bg-amber-50 text-amber-900"
        role="status"
        aria-live="polite"
      >
        <svg class="flex-shrink-0 text-amber-600" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true" focusable="false">
          <line x1="2" y1="2" x2="22" y2="22"></line>
          <path d="M8.5 16.5a5 5 0 0 1 7 0"></path>
          <path d="M2 8.82a15 15 0 0 1 4.17-2.65"></path>
          <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"></path>
          <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"></path>
          <path d="M5 13a10 10 0 0 1 5.24-2.76"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
        <span>You're offline — check your connection.</span>
      </div>
    }
  `,
  host: { class: 'contents' },
})
export class OfflineBannerComponent {
  readonly connectivity = inject(ConnectivityService);
}
