// Multi-mode placeholder surface for the reports tables — mirrors the dashboard
// CardError style (app-dn-card wrapper, inline SVG, title/message/retry). One
// component covers every non-table state, including the under-construction
// placeholder for reports we haven't built yet and the long-range listing guard.

import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../_shared/ui/card/card.component';

export type ReportStateMode =
  | 'select-date'
  | 'loading'
  | 'empty'
  | 'error'
  | 'under-construction'
  | 'listing-guard';

interface StateCopy {
  title: string;
  message: string;
}

// Non-custodial copy only — never payout/settlement/balance/funds/wallet.
const DEFAULT_COPY: Record<ReportStateMode, StateCopy> = {
  'select-date': {
    title: 'Choose a date range',
    message: 'Pick a period above to see your sales for that time.',
  },
  loading: { title: '', message: '' },
  empty: {
    title: 'Nothing to show yet',
    message: 'No orders were recorded for the dates you selected.',
  },
  error: {
    title: "Couldn't load this report",
    message: 'Something went wrong loading your sales for this period.',
  },
  'under-construction': {
    title: "We're still building this report",
    message: "This report isn't available yet — check back soon.",
  },
  'listing-guard': {
    title: 'Order list hidden for long ranges',
    message:
      'The order-by-order list is available for ranges of 31 days or less. The summary above still covers your full selection.',
  },
};

@Component({
  selector: 'app-report-state',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <app-dn-card>
      @if (mode === 'loading') {
        <div class="p-6 space-y-3" aria-busy="true" aria-live="polite">
          <div class="h-4 w-1/3 bg-muted rounded animate-pulse"></div>
          @for (row of skeletonRows; track row) {
            <div class="h-10 bg-muted rounded animate-pulse"></div>
          }
        </div>
      } @else {
        <div class="flex flex-col items-center justify-center min-h-[200px] text-center p-6">
          <div class="mb-4" [ngClass]="mode === 'error' ? 'text-destructive' : 'text-muted-foreground'">
            <svg
              aria-hidden="true"
              class="w-12 h-12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <ng-container [ngSwitch]="mode">
                <ng-container *ngSwitchCase="'error'">
                  <svg:circle cx="12" cy="12" r="10" />
                  <svg:line x1="12" x2="12" y1="8" y2="12" />
                  <svg:line x1="12" x2="12.01" y1="16" y2="16" />
                </ng-container>
                <ng-container *ngSwitchCase="'empty'">
                  <svg:polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <svg:path
                    d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
                  />
                </ng-container>
                <ng-container *ngSwitchCase="'listing-guard'">
                  <svg:circle cx="12" cy="12" r="10" />
                  <svg:path d="M12 16v-4" />
                  <svg:path d="M12 8h.01" />
                </ng-container>
                <ng-container *ngSwitchCase="'under-construction'">
                  <svg:path
                    d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                  />
                </ng-container>
                <ng-container *ngSwitchDefault>
                  <svg:rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                  <svg:line x1="16" x2="16" y1="2" y2="6" />
                  <svg:line x1="8" x2="8" y1="2" y2="6" />
                  <svg:line x1="3" x2="21" y1="10" y2="10" />
                </ng-container>
              </ng-container>
            </svg>
          </div>

          <h3 class="text-lg font-semibold text-foreground mb-2">{{ resolvedTitle }}</h3>
          <p class="text-sm text-muted-foreground mb-4 max-w-md">{{ resolvedMessage }}</p>

          @if (mode === 'error') {
            <button
              type="button"
              (click)="retry.emit()"
              class="inline-flex items-center gap-2 border border-border rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
            >
              <svg
                aria-hidden="true"
                class="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <svg:path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <svg:path d="M21 3v5h-5" />
                <svg:path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <svg:path d="M3 21v-5h5" />
              </svg>
              Try again
            </button>
          }
        </div>
      }
    </app-dn-card>
  `,
})
export class ReportStateComponent {
  @Input() mode: ReportStateMode = 'loading';
  @Input() title?: string;
  @Input() message?: string;
  @Output() retry = new EventEmitter<void>();

  readonly skeletonRows = [1, 2, 3, 4];

  get resolvedTitle(): string {
    return this.title ?? DEFAULT_COPY[this.mode].title;
  }

  get resolvedMessage(): string {
    return this.message ?? DEFAULT_COPY[this.mode].message;
  }
}
