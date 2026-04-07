import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-kds-bullet-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <!-- Bullet bar container -->
      <div class="relative h-10 rounded-lg overflow-hidden">
        <!-- Background bands -->
        <div class="absolute inset-0 flex">
          <div class="h-full bg-success" [style.width.%]="targetPct"></div>
          <div class="h-full bg-warning" [style.width.%]="cautionPct"></div>
          <div class="h-full bg-destructive" [style.width.%]="latePct"></div>
        </div>

        <!-- Target marker -->
        <div
          class="absolute top-0 bottom-0 w-0.5 bg-success z-10"
          [style.left.%]="targetPct"
        >
          <div class="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            <span class="text-[10px] font-medium text-success">
              Target: {{ targetMinutes }}m
            </span>
          </div>
        </div>

        <!-- Late marker -->
        <div
          class="absolute top-0 bottom-0 w-0.5 bg-destructive z-10"
          [style.left.%]="latePosPercent"
        >
          <div class="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
            <span class="text-[10px] font-medium text-destructive">
              Late: {{ lateMinutes }}m
            </span>
          </div>
        </div>

        <!-- Current value indicator -->
        <div
          class="absolute top-1/2 -translate-y-1/2 z-20 flex flex-col items-center"
          [style.left.%]="currentPct"
        >
          <div
            class="w-2 h-14 rounded-full bg-black shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
            [class.ring-4]="true"
            [class.ring-success]="status === 'on_target'"
            [class.ring-warning]="status === 'caution'"
            [class.ring-destructive]="status === 'late'"
          ></div>
        </div>
      </div>

      <!-- Current value label -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span
            class="text-sm font-bold"
            [class.text-success]="status === 'on_target'"
            [class.text-warning]="status === 'caution'"
            [class.text-destructive]="status === 'late'"
          >
            Avg fulfillment time: {{ currentValue.toFixed(1) }}m
          </span>
          @if (status === 'caution' || status === 'late') {
            <span
              class="text-xs font-medium"
              [class.text-warning]="status === 'caution'"
              [class.text-destructive]="status === 'late'"
            >
              +{{ overTargetMinutes.toFixed(1) }}m over target
            </span>
          }
        </div>
      </div>

      <!-- Scale markers -->
      <div class="flex justify-between text-[10px] text-foreground px-0.5">
        <span>0</span>
        <span>{{ midScale }}</span>
        <span>{{ scaleMax }}m</span>
      </div>
    </div>
  `,
})
export class KdsBulletBarComponent {
  @Input() currentValue = 0;
  @Input() targetMinutes = 8;
  @Input() lateMinutes = 12;
  @Input() oldestTicketMinutes = 0;

  get scaleMax(): number {
    const rawMax = Math.max(
      this.lateMinutes * 1.5,
      this.currentValue * 1.2,
      this.oldestTicketMinutes * 1.1,
    );
    return Math.max(Math.ceil(rawMax / 5) * 5, 5);
  }

  get midScale(): number {
    return Math.round(this.scaleMax / 2);
  }

  get targetPct(): number {
    return (this.targetMinutes / this.scaleMax) * 100;
  }

  get latePosPercent(): number {
    return (this.lateMinutes / this.scaleMax) * 100;
  }

  get cautionPct(): number {
    return this.latePosPercent - this.targetPct;
  }

  get latePct(): number {
    return 100 - this.latePosPercent;
  }

  get currentPct(): number {
    return Math.min((this.currentValue / this.scaleMax) * 100, 100);
  }

  get status(): 'on_target' | 'caution' | 'late' {
    if (this.currentValue <= this.targetMinutes) return 'on_target';
    if (this.currentValue <= this.lateMinutes) return 'caution';
    return 'late';
  }

  get overTargetMinutes(): number {
    return Math.max(0, this.currentValue - this.targetMinutes);
  }
}
