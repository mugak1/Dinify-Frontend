import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { TrendIndicatorComponent } from '../trend-indicator/trend-indicator.component';
import { TablesData } from '../../models/dashboard.models';
import { formatCompact } from '../../utils/format.utils';

@Component({
  selector: 'app-tables-card',
  standalone: true,
  host: { class: 'block h-full' },
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    CardSkeletonComponent,
    AnimatedNumberComponent,
    TrendIndicatorComponent,
  ],
  template: `
    @if (loading) {
      <app-card-skeleton variant="compact"></app-card-skeleton>
    } @else if (!tablesData) {
      <app-dn-card [fullHeight]="true">
        <div class="p-4 sm:p-5 h-full flex flex-col overflow-hidden">
          <h2 class="text-sm sm:text-base font-bold text-foreground mb-1">Tables</h2>
          <hr class="border-border mb-3" />
          <div class="flex-1 flex items-center justify-center">
            <p class="text-sm text-muted-foreground text-center">No table data available</p>
          </div>
        </div>
      </app-dn-card>
    } @else {
      <app-dn-card [fullHeight]="true">
        <div class="p-4 sm:p-5 lg:p-6 overflow-hidden flex flex-col h-full">
          <!-- Header -->
          <div class="flex items-start justify-between mb-4 sm:mb-5">
            <h2 class="text-base sm:text-lg font-bold text-foreground">Tables</h2>
            <a routerLink="/dining-tables" class="text-xs sm:text-sm text-primary hover:underline whitespace-nowrap">
              View tables ›
            </a>
          </div>

          <!-- 2x2 grid -->
          <div class="grid grid-cols-2 gap-2 sm:gap-3 flex-1">
            <!-- Tile 1: Current Occupancy -->
            <div
              class="p-3 sm:p-4 rounded-lg border overflow-hidden flex flex-col"
              [class]="occupancyBgClass"
            >
              <div class="flex items-center gap-1.5 mb-1">
                <!-- Users icon -->
                <svg aria-hidden="true" [class]="'w-3.5 h-3.5 shrink-0 ' + occupancyIconColor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span class="text-[11px] sm:text-xs font-medium text-muted-foreground truncate">
                  Current occupancy
                </span>
              </div>
              <app-animated-number
                [value]="occupancyPct"
                [duration]="2000"
                suffix="%"
                class="text-lg sm:text-xl font-bold tabular-nums block"
                [class]="occupancyValueColor"
              ></app-animated-number>
              <div class="text-[10px] sm:text-xs text-muted-foreground">
                {{ tablesData.occupied }} / {{ tablesData.total }} tables occupied
              </div>
              <div class="mt-auto pt-2">
                <span
                  class="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full border font-medium"
                  [class]="statusBadgeClass"
                >
                  {{ statusBadgeText }}
                </span>
              </div>
            </div>

            <!-- Tile 2: Median Occupancy Time -->
            <div class="p-3 sm:p-4 bg-gradient-to-br from-muted to-muted/50 rounded-lg border overflow-hidden flex flex-col">
              <div class="flex items-center gap-1.5 mb-1">
                <!-- Timer icon -->
                <svg aria-hidden="true" class="w-3.5 h-3.5 text-chart-1 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span class="text-[11px] sm:text-xs font-medium text-muted-foreground truncate">
                  Median occupancy time
                </span>
              </div>
              <div class="text-lg sm:text-xl font-bold text-foreground tabular-nums">
                @if (medianVisit !== null && medianVisit > 0) {
                  {{ medianVisit }}m
                } @else {
                  –
                }
              </div>
              <div class="text-[10px] sm:text-xs text-muted-foreground mt-auto">
                Open tables
              </div>
            </div>

            <!-- Tile 3: Table Turns (Today) -->
            <div class="p-3 sm:p-4 bg-gradient-to-br from-muted to-muted/50 rounded-lg border overflow-hidden flex flex-col">
              <div class="flex items-center gap-1.5 mb-1">
                <!-- RotateCw icon -->
                <svg aria-hidden="true" class="w-3.5 h-3.5 text-chart-2 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
                <span class="text-[11px] sm:text-xs font-medium text-muted-foreground truncate">
                  Table turns (today)
                </span>
              </div>
              <div class="text-lg sm:text-xl font-bold text-foreground tabular-nums">
                {{ turnsToday.toFixed(1) }}\u00d7
              </div>
              <div class="text-[10px] sm:text-xs text-muted-foreground">
                Seatings per table
              </div>
              <div class="mt-auto pt-1.5 sm:pt-2 min-w-0">
                <app-trend-indicator
                  [current]="turnsToday"
                  [previous]="turnsYesterday"
                ></app-trend-indicator>
              </div>
            </div>

            <!-- Tile 4: Avg Order Value -->
            <div class="p-3 sm:p-4 bg-gradient-to-br from-muted to-muted/50 rounded-lg border overflow-hidden flex flex-col">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-[11px] sm:text-xs font-medium text-muted-foreground truncate">
                  Avg order value
                </span>
              </div>
              <span class="text-lg sm:text-xl font-bold text-foreground tabular-nums">
                <app-animated-number
                  [value]="avgTicketToday"
                  [duration]="2000"
                  [formatFn]="compactFormatter"
                ></app-animated-number>
              </span>
              <div class="text-[10px] sm:text-xs text-muted-foreground">
                Per table
              </div>
              <div class="mt-auto pt-1.5 sm:pt-2 min-w-0">
                <app-trend-indicator
                  [current]="avgTicketToday"
                  [previous]="avgTicketYesterday"
                ></app-trend-indicator>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="pt-3 sm:pt-4 mt-3 sm:mt-4 border-t">
            <p class="text-[10px] sm:text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
              <!-- Activity icon -->
              <svg aria-hidden="true" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              Live table data · updates every 30s
            </p>
          </div>
        </div>
      </app-dn-card>
    }
  `,
})
export class TablesCardComponent {
  @Input() tablesData: TablesData | null = null;
  @Input() loading = false;

  readonly compactFormatter = (v: number) => formatCompact(v);

  get occupancyPct(): number {
    if (!this.tablesData) return 0;
    return this.tablesData.occupancy_pct ??
      (this.tablesData.total > 0
        ? Math.round((this.tablesData.occupied / this.tablesData.total) * 100)
        : 0);
  }

  get occupancyBgClass(): string {
    if (this.occupancyPct >= 85) return 'bg-gradient-to-br from-destructive/10 to-destructive/5';
    if (this.occupancyPct >= 70) return 'bg-gradient-to-br from-success/10 to-success/5';
    return 'bg-gradient-to-br from-muted to-muted/50';
  }

  get occupancyIconColor(): string {
    if (this.occupancyPct >= 85) return 'text-destructive';
    if (this.occupancyPct >= 70) return 'text-success';
    return 'text-foreground';
  }

  get occupancyValueColor(): string {
    if (this.occupancyPct >= 85) return 'text-destructive';
    if (this.occupancyPct >= 70) return 'text-success';
    return 'text-foreground';
  }

  get statusBadgeText(): string {
    if (this.occupancyPct >= 90) return 'Over capacity';
    if (this.occupancyPct >= 70) return 'Optimal';
    if (this.occupancyPct >= 40) return 'Moderate';
    return 'Low';
  }

  get statusBadgeClass(): string {
    if (this.occupancyPct >= 90) return 'bg-destructive/15 text-destructive border-destructive/30';
    if (this.occupancyPct >= 70) return 'bg-success/15 text-success border-success/30';
    if (this.occupancyPct >= 40) return 'bg-warning/15 text-warning border-warning/30';
    return 'bg-muted text-muted-foreground border-border';
  }

  get medianVisit(): number | null {
    if (!this.tablesData) return null;
    const v = this.tablesData.median_visit_minutes;
    return v !== undefined && v !== null ? Math.round(v) : null;
  }

  get turnsToday(): number {
    return this.tablesData?.turns_today ?? 0;
  }

  get turnsYesterday(): number {
    return this.tablesData?.turns_yesterday ?? 0;
  }

  get avgTicketToday(): number {
    return this.tablesData?.avg_ticket_today ?? 0;
  }

  get avgTicketYesterday(): number {
    return this.tablesData?.avg_ticket_yesterday ?? 0;
  }
}
