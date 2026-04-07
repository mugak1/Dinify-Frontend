import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../_shared/ui/card/card.component';
import { CardSkeletonComponent } from '../card-skeleton/card-skeleton.component';
import { AnimatedNumberComponent } from '../animated-number/animated-number.component';
import { KdsBulletBarComponent } from '../kds-bullet-bar/kds-bullet-bar.component';
import { KdsData } from '../../models/dashboard.models';

type KitchenStatus = 'on_track' | 'at_risk' | 'in_weeds';

const STATUS_CONFIG: Record<KitchenStatus, { label: string; badgeClass: string }> = {
  on_track: {
    label: 'On track',
    badgeClass: 'bg-success text-white',
  },
  at_risk: {
    label: 'At risk',
    badgeClass: 'bg-warning text-warning-foreground',
  },
  in_weeds: {
    label: 'In the weeds',
    badgeClass: 'bg-destructive text-white',
  },
};

@Component({
  selector: 'app-kds-attention-card',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    CardSkeletonComponent,
    AnimatedNumberComponent,
    KdsBulletBarComponent,
  ],
  template: `
    @if (loading) {
      <app-card-skeleton variant="wide"></app-card-skeleton>
    } @else if (!kdsData) {
      <app-dn-card>
        <div class="p-4 sm:p-5 h-full flex flex-col overflow-hidden">
          <h2 class="text-sm sm:text-base font-bold text-foreground mb-1">Kitchen Load (KDS)</h2>
          <hr class="border-border mb-3" />
          <div class="flex-1 flex items-center justify-center">
            <p class="text-sm text-muted-foreground text-center">No KDS data available</p>
          </div>
        </div>
      </app-dn-card>
    } @else {
      <app-dn-card>
        <div class="p-6 transition-all">
          <!-- Header -->
          <div class="flex items-start justify-between gap-2 mb-4 sm:mb-6">
            <div class="flex-1 min-w-0">
              <h2 class="text-base sm:text-lg font-bold text-foreground mb-1">Kitchen Load (KDS)</h2>
              <p class="text-[10px] sm:text-xs text-muted-foreground">Current kitchen load compared to targets</p>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 shrink-0">
              <span
                class="text-[10px] sm:text-xs font-semibold px-2 sm:px-3 py-0.5 sm:py-1 rounded-full inline-flex items-center"
                [class]="statusConfig.badgeClass"
              >
                {{ statusConfig.label }}
              </span>
              <a routerLink="/kds/expo" class="text-xs sm:text-sm text-primary hover:underline flex items-center gap-0.5 font-medium whitespace-nowrap">
                <span class="hidden sm:inline">Open </span>Expo <span class="text-base sm:text-lg leading-none">›</span>
              </a>
            </div>
          </div>

          <!-- Top KPI Row -->
          <div class="grid grid-cols-3 gap-4 mb-6">
            <div class="flex flex-col">
              <app-animated-number
                [value]="openTickets"
                [duration]="2000"
                class="text-3xl font-bold text-foreground"
              ></app-animated-number>
              <div class="text-xs text-muted-foreground mt-1">Open tickets</div>
            </div>
            <div class="flex flex-col border-x border-border px-4">
              <app-animated-number
                [value]="kdsData.over_sla"
                [duration]="2000"
                class="text-3xl font-bold text-foreground"
              ></app-animated-number>
              <div class="text-xs text-muted-foreground mt-1">
                Open tickets past target ·
                <span class="text-destructive font-medium">{{ overSlaPct }}%</span>
              </div>
            </div>
            <div class="flex flex-col">
              <app-animated-number
                [value]="avgFulfillmentMinutes"
                [duration]="2000"
                [decimals]="1"
                suffix=" min"
                class="text-3xl font-bold text-foreground"
              ></app-animated-number>
              <div class="text-xs text-muted-foreground mt-1">Avg fulfillment time</div>
            </div>
          </div>

          <!-- Bullet Bar -->
          <div class="mb-6 pt-6">
            <app-kds-bullet-bar
              [currentValue]="avgFulfillmentMinutes"
              [targetMinutes]="targetMinutes"
              [lateMinutes]="lateMinutes"
              [oldestTicketMinutes]="oldestTicketMinutes"
            ></app-kds-bullet-bar>
          </div>

          <!-- Oldest ticket callout -->
          <div class="flex items-center justify-center gap-2 mb-6 py-3 bg-muted/50 rounded-lg">
            <!-- Clock icon -->
            <svg
              class="w-5 h-5"
              [class.text-destructive]="alertState === 'critical'"
              [class.text-warning]="alertState === 'warning'"
              [class.text-muted-foreground]="alertState === 'safe'"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span
              class="text-lg font-bold"
              [class.text-destructive]="alertState === 'critical'"
              [class.text-warning]="alertState === 'warning'"
              [class.text-foreground]="alertState === 'safe'"
            >
              Oldest ticket: {{ oldestTicketMinutes }}m
            </span>
            @if (alertState === 'critical') {
              <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold bg-destructive text-white border-destructive">
                AT RISK
              </span>
            }
            @if (alertState === 'warning') {
              <span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-warning text-warning-foreground border-warning">
                Warning
              </span>
            }
          </div>

          <!-- Insight Chips -->
          <div class="flex flex-wrap gap-2 mb-4">
            <div class="px-3 py-1.5 bg-warning/10 border border-warning/20 rounded-full text-xs flex items-center gap-1.5">
              <!-- Flame icon -->
              <svg class="w-3.5 h-3.5 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
              </svg>
              <span class="font-medium">Busiest: Grill · 24 items</span>
            </div>
            <div class="px-3 py-1.5 bg-warning/10 border border-warning/20 rounded-full text-xs flex items-center gap-1.5">
              <!-- AlertTriangle icon -->
              <svg class="w-3.5 h-3.5 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span class="font-medium">Allergens: 3 active</span>
            </div>
            <div class="px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-full text-xs flex items-center gap-1.5">
              <!-- Zap icon -->
              <svg class="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              <span class="font-medium">Expo: last action 18s ago</span>
            </div>
          </div>

          <!-- Footer -->
          <p class="text-xs text-muted-foreground text-center">
            Live from Expo
          </p>
        </div>
      </app-dn-card>
    }
  `,
})
export class KdsAttentionCardComponent {
  @Input() kdsData: KdsData | null = null;
  @Input() loading = false;

  get openTickets(): number {
    if (!this.kdsData) return 0;
    return this.kdsData.open_tickets ?? this.kdsData.active ?? 0;
  }

  get overSlaPct(): number {
    if (!this.kdsData || this.openTickets === 0) return 0;
    return Math.round((this.kdsData.over_sla / this.openTickets) * 100);
  }

  get avgFulfillmentMinutes(): number {
    return this.kdsData?.avg_fulfillment_minutes ?? 0;
  }

  get targetMinutes(): number {
    return this.kdsData?.target_minutes ?? 8;
  }

  get lateMinutes(): number {
    return this.kdsData?.late_minutes ?? 12;
  }

  get oldestTicketMinutes(): number {
    return this.kdsData?.oldest_ticket_minutes ?? 0;
  }

  get kitchenStatus(): KitchenStatus {
    if (!this.kdsData) return 'on_track';
    if (this.kdsData.over_sla >= 3) return 'in_weeds';
    if (this.kdsData.at_risk >= 2 || this.kdsData.over_sla >= 1) return 'at_risk';
    return 'on_track';
  }

  get statusConfig(): { label: string; badgeClass: string } {
    return STATUS_CONFIG[this.kitchenStatus];
  }

  get alertState(): 'critical' | 'warning' | 'safe' {
    if (this.oldestTicketMinutes > 20) return 'critical';
    if (this.oldestTicketMinutes > 15) return 'warning';
    return 'safe';
  }
}
