import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { cn } from '../../utils/cn';

@Component({
  selector: 'dn-sheet',
  standalone: true,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50">
        <div class="fixed inset-0 bg-black/50 transition-opacity" (click)="close()"></div>
        <div [class]="panelClass" [style.width]="width">
          <ng-content></ng-content>
        </div>
      </div>
    }
  `,
})
export class SheetComponent {
  @Input() open = false;
  @Input() side: 'left' | 'right' = 'right';
  @Input() width = '400px';
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.close();
    }
  }

  get panelClass(): string {
    return cn(
      'fixed top-0 h-full bg-card shadow-lg z-50 transition-transform overflow-y-auto',
      this.side === 'right' ? 'right-0' : 'left-0'
    );
  }

  close(): void {
    this.open = false;
    this.closed.emit();
  }
}
