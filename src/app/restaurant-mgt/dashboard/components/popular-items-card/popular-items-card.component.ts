import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { PopularItemData } from '../../models/dashboard.models';
import { formatCurrency } from '../../utils/format.utils';

@Component({
  selector: 'app-popular-items-card',
  standalone: true,
  host: { class: 'block h-full' },
  imports: [CommonModule, RouterModule, CardComponent, CardSkeletonComponent],
  template: `
    @if (loading) {
      <app-card-skeleton variant="compact"></app-card-skeleton>
    } @else if (!items || items.length === 0) {
      <app-dn-card [fullHeight]="true">
        <div class="p-4 sm:p-5 md:p-6">
          <h2 class="text-sm sm:text-base font-bold text-foreground mb-3">Popular Items</h2>
          <hr class="border-border mb-4" />
          <p class="text-sm text-muted-foreground text-center py-8">No item data available</p>
        </div>
      </app-dn-card>
    } @else {
      <app-dn-card [fullHeight]="true">
        <div class="p-4 sm:p-5 md:p-6 overflow-hidden">
          <!-- Header -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 sm:mb-4">
            <h2 class="text-sm sm:text-base font-bold text-foreground">Popular Items</h2>
            <div class="flex gap-1">
              <button
                (click)="sortBy = 'income'"
                class="px-2 py-1 rounded text-xs font-medium transition-colors"
                [class]="sortBy === 'income' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
              >
                By Revenue
              </button>
              <button
                (click)="sortBy = 'quantity'"
                class="px-2 py-1 rounded text-xs font-medium transition-colors"
                [class]="sortBy === 'quantity' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
              >
                By Quantity
              </button>
            </div>
          </div>

          <hr class="border-border mb-3 sm:mb-4" />

          <!-- Table -->
          <div class="overflow-hidden flex-1">
            <table class="w-full table-fixed">
              <thead>
                <tr class="border-b border-border text-left">
                  <th class="pb-3 w-[28px] text-[10px] sm:text-xs font-medium text-muted-foreground">#</th>
                  <th class="pb-3 text-[10px] sm:text-xs font-medium text-muted-foreground text-left">Item</th>
                  <th class="pb-3 w-[70px] sm:w-[90px] text-[10px] sm:text-xs font-medium text-muted-foreground text-right pr-2">
                    {{ sortBy === 'income' ? 'Revenue' : 'Qty' }}
                  </th>
                  <th class="pb-3 w-[50px] sm:w-[55px] text-[10px] sm:text-xs font-medium text-muted-foreground text-right">%</th>
                </tr>
              </thead>
              <tbody>
                @for (item of displayItems; track item.item_id; let i = $index) {
                  <tr class="border-b border-border last:border-0">
                    <td class="py-4 text-sm font-medium text-muted-foreground">{{ i + 1 }}</td>
                    <td class="py-4 pr-2">
                      <div class="flex items-center gap-2 min-w-0">
                        @if (item.image_url) {
                          <img
                            [src]="item.image_url"
                            [alt]="item.name"
                            class="w-8 h-8 rounded object-cover shrink-0"
                          />
                        } @else {
                          <div class="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                            <svg aria-hidden="true" class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
                              <path d="M7 2v20"/>
                              <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
                            </svg>
                          </div>
                        }
                        <span class="font-medium text-sm truncate">{{ item.name }}</span>
                      </div>
                    </td>
                    <td class="py-4 text-right pr-2">
                      <span class="font-semibold text-sm tabular-nums">
                        {{ sortBy === 'income' ? formatCurrencyValue(item.revenue) : item.qty }}
                      </span>
                    </td>
                    <td class="py-4 text-right">
                      <span class="text-sm text-muted-foreground tabular-nums">{{ getPercentage(item) }}%</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Footer link -->
          <a
            routerLink="/rest-app/reports"
            class="text-xs text-primary hover:underline flex items-center gap-1 mt-3 sm:mt-4"
          >
            See full list
            <svg aria-hidden="true" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
            </svg>
          </a>
        </div>
      </app-dn-card>
    }
  `,
})
export class PopularItemsCardComponent {
  @Input() items: PopularItemData[] | null = null;
  @Input() loading = false;

  sortBy: 'income' | 'quantity' = 'income';

  get displayItems(): PopularItemData[] {
    if (!this.items) return [];
    const sorted = [...this.items].sort((a, b) =>
      this.sortBy === 'income' ? b.revenue - a.revenue : b.qty - a.qty,
    );
    return sorted.slice(0, 5);
  }

  get totalValue(): number {
    return this.displayItems.reduce(
      (sum, item) => sum + (this.sortBy === 'income' ? item.revenue : item.qty),
      0,
    );
  }

  formatCurrencyValue(value: number): string {
    return formatCurrency(value);
  }

  getPercentage(item: PopularItemData): string {
    const value = this.sortBy === 'income' ? item.revenue : item.qty;
    if (this.totalValue === 0) return '0.0';
    return ((value / this.totalValue) * 100).toFixed(1);
  }
}
