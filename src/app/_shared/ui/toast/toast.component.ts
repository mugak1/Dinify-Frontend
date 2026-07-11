import { Component } from '@angular/core';
import { ToastService, Toast } from './toast.service';

// Colours route through the semantic tokens (not raw green/red/amber literals) so
// toasts track the design system and any future re-theme.
const borderColors: Record<Toast['type'], string> = {
  success: 'border-l-success',
  error: 'border-l-destructive',
  warning: 'border-l-warning',
  info: 'border-l-primary',
};

// Icon tint mirrors the left border so each type reads at a glance.
const iconColors: Record<Toast['type'], string> = {
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-primary',
};

// Errors and warnings interrupt (assertive alert); success/info wait their turn
// (polite status) so they don't talk over whatever the user is doing.
function isUrgent(type: Toast['type']): boolean {
  return type === 'error' || type === 'warning';
}

@Component({
  selector: 'app-dn-toast',
  standalone: true,
  template: `
    <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      @for (toast of toastService.toasts; track toast.id) {
        <div
          [attr.role]="urgent(toast.type) ? 'alert' : 'status'"
          [attr.aria-live]="urgent(toast.type) ? 'assertive' : 'polite'"
          class="bg-card text-card-foreground shadow-[var(--shadow-md)] rounded-lg px-4 py-3 border-l-4 min-w-[280px] max-w-sm flex items-start gap-3"
          [class]="borderColor(toast.type)"
        >
          <span class="shrink-0 mt-0.5" [class]="iconColor(toast.type)">
            @switch (toast.type) {
              @case ('success') {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              }
              @case ('error') {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              }
              @case ('warning') {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              }
              @default {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              }
            }
          </span>

          <span class="text-sm flex-1">{{ toast.message }}</span>

          <button
            type="button"
            class="shrink-0 -mr-1 -mt-0.5 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss notification"
            (click)="toastService.dismiss(toast.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  constructor(public toastService: ToastService) {}

  borderColor(type: Toast['type']): string {
    return borderColors[type];
  }

  iconColor(type: Toast['type']): string {
    return iconColors[type];
  }

  urgent(type: Toast['type']): boolean {
    return isUrgent(type);
  }
}
