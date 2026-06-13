import { Component, Input } from '@angular/core';
import { CardComponent } from '../../../../_shared/ui/card/card.component';

@Component({
  selector: 'app-card-skeleton',
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-dn-card>
      @switch (variant) {
        @case ('compact') {
          <div class="p-4">
            <!-- Header -->
            <div class="flex items-center justify-between mb-3">
              <div class="h-5 w-32 bg-muted rounded animate-pulse"></div>
              <div class="h-5 w-20 bg-muted rounded animate-pulse"></div>
            </div>
            <div class="h-px bg-border mb-3"></div>
            <!-- List items -->
            @for (i of [1, 2, 3]; track i) {
              <div class="flex items-center gap-3 mb-3">
                <div class="w-8 h-8 bg-muted rounded animate-pulse shrink-0"></div>
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-full bg-muted rounded animate-pulse"></div>
                  <div class="h-3 w-3/4 bg-muted rounded animate-pulse"></div>
                </div>
              </div>
            }
          </div>
        }
        @case ('wide') {
          <div class="p-6">
            <!-- Header -->
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1">
                <div class="h-6 w-48 bg-muted rounded animate-pulse mb-2"></div>
                <div class="h-9 w-32 bg-muted rounded animate-pulse"></div>
              </div>
              <div class="h-5 w-24 bg-muted rounded animate-pulse"></div>
            </div>
            <div class="h-px bg-border mb-4"></div>
            <!-- Stat row -->
            <div class="flex gap-2 mb-4">
              @for (j of [1, 2, 3, 4]; track j) {
                <div class="flex-1 h-16 bg-muted rounded animate-pulse"></div>
              }
            </div>
            <div class="h-px bg-border my-4"></div>
            <!-- Chart area -->
            <div class="h-5 w-32 bg-muted rounded animate-pulse mb-3"></div>
            <div class="h-40 bg-muted rounded animate-pulse"></div>
          </div>
        }
        @default {
          <div class="p-6">
            <!-- Header -->
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1">
                <div class="h-6 w-48 bg-muted rounded animate-pulse mb-2"></div>
                <div class="h-9 w-32 bg-muted rounded animate-pulse"></div>
              </div>
              <div class="h-5 w-24 bg-muted rounded animate-pulse"></div>
            </div>
            <div class="h-px bg-border mb-4"></div>
            <!-- Stats -->
            <div class="flex gap-2 mb-4">
              @for (j of [1, 2, 3, 4]; track j) {
                <div class="flex-1 h-16 bg-muted rounded animate-pulse"></div>
              }
            </div>
            <!-- Chart area -->
            <div class="h-px bg-border my-4"></div>
            <div class="h-5 w-32 bg-muted rounded animate-pulse mb-3"></div>
            <div class="h-40 bg-muted rounded animate-pulse"></div>
          </div>
        }
      }
    </app-dn-card>
  `,
})
export class CardSkeletonComponent {
  @Input() variant: 'default' | 'compact' | 'wide' = 'default';
}
