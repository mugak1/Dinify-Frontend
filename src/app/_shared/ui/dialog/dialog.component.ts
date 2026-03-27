import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';

@Component({
  selector: 'dn-dialog',
  standalone: true,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="fixed inset-0 bg-black/50" (click)="close()"></div>
        <div class="relative z-50 bg-card rounded-lg shadow-lg p-6 max-w-lg w-full mx-4">
          <ng-content></ng-content>
        </div>
      </div>
    }
  `,
})
export class DialogComponent {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.close();
    }
  }

  close(): void {
    this.open = false;
    this.closed.emit();
  }
}
