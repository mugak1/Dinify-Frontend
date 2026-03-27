import { Component } from '@angular/core';
import { ToastService, Toast } from './toast.service';

const borderColors: Record<Toast['type'], string> = {
  success: 'border-l-green-500',
  error: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-primary',
};

@Component({
  selector: 'app-dn-toast',
  standalone: true,
  template: `
    <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      @for (toast of toastService.toasts; track toast.id) {
        <div
          class="bg-card text-card-foreground shadow-[var(--shadow-md)] rounded-lg px-4 py-3 border-l-4 min-w-[280px] max-w-sm"
          [class]="borderColor(toast.type)"
        >
          <span class="text-sm">{{ toast.message }}</span>
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
}
