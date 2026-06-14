import { Injectable } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

// Errors linger a touch longer so they're readable; everything else 4s.
const DURATIONS: Record<Toast['type'], number> = {
  success: 4000,
  warning: 4000,
  info: 4000,
  error: 6000,
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts: Toast[] = [];
  private nextId = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  success(message: string): void { this.add(message, 'success'); }
  error(message: string): void { this.add(message, 'error'); }
  warning(message: string): void { this.add(message, 'warning'); }
  info(message: string): void { this.add(message, 'info'); }

  private add(message: string, type: Toast['type']): void {
    // De-dupe: a repeated identical message (e.g. a 4s poll failing during an
    // outage) refreshes the existing toast's timer in place instead of stacking
    // a new card, so it stays visible for the duration of the repeats.
    const existing = this.toasts.find((t) => t.message === message && t.type === type);
    if (existing) {
      this.scheduleDismiss(existing.id, type);
      return;
    }
    const id = this.nextId++;
    this.toasts.push({ id, message, type });
    this.scheduleDismiss(id, type);
  }

  private scheduleDismiss(id: number, type: Toast['type']): void {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.dismiss(id), DURATIONS[type]));
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  /** Dismiss every visible toast at once. Used by the diner inline-error
   *  handlers and clear-then-own-toast sites that previously cleared the banner. */
  clear(): void {
    this.timers.forEach((handle) => clearTimeout(handle));
    this.timers.clear();
    this.toasts = [];
  }
}
