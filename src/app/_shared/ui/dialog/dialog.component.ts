import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';

export type DialogMaxWidth = 'sm' | 'md' | 'lg';

const maxWidthClasses: Record<DialogMaxWidth, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
};

@Component({
  selector: 'app-dn-dialog',
  standalone: true,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="fixed inset-0 bg-black/50" (click)="onBackdrop()"></div>
        <div [class]="'relative z-50 bg-card rounded-lg shadow-lg p-6 w-full mx-4 ' + maxWidthClass">
          <ng-content></ng-content>
        </div>
      </div>
    }
  `,
})
export class DialogComponent {
  @Input() open = false;
  @Input() maxWidth: DialogMaxWidth = 'md';
  /**
   * When true, backdrop clicks and the Escape key do NOT close the dialog —
   * the only way out is an explicit in-content action. Default false preserves
   * every existing consumer. Used by the create-employee credential dialog,
   * whose one-time password must not be dismissed by accident.
   */
  @Input() disableClose = false;
  @Output() closed = new EventEmitter<void>();

  get maxWidthClass(): string {
    return maxWidthClasses[this.maxWidth] ?? 'max-w-lg';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open && !this.disableClose) {
      this.close();
    }
  }

  onBackdrop(): void {
    if (this.disableClose) return;
    this.close();
  }

  close(): void {
    this.open = false;
    this.closed.emit();
  }
}
