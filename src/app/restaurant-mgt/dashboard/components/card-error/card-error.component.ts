import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CardComponent } from '../../../../_shared/ui/card/card.component';

@Component({
  selector: 'app-card-error',
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-dn-card>
      <div class="flex flex-col items-center justify-center min-h-[200px] text-center p-6">
        <!-- AlertCircle icon -->
        <div class="mb-4">
          <svg class="w-12 h-12 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" x2="12" y1="8" y2="12"/>
            <line x1="12" x2="12.01" y1="16" y2="16"/>
          </svg>
        </div>

        <h3 class="text-lg font-semibold text-foreground mb-2">{{ title }}</h3>
        <p class="text-sm text-muted-foreground mb-4 max-w-md">{{ message }}</p>

        <button
          (click)="retry.emit()"
          class="inline-flex items-center gap-2 border border-border rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors"
        >
          <!-- RefreshCw icon -->
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M3 21v-5h5"/>
          </svg>
          Try Again
        </button>
      </div>
    </app-dn-card>
  `,
})
export class CardErrorComponent {
  @Input() title = 'Error loading data';
  @Input() message = 'Something went wrong while loading this data.';
  @Output() retry = new EventEmitter<void>();
}
