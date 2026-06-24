import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { cn } from '../../utils/cn';

@Component({
  selector: 'app-dn-sheet',
  standalone: true,
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50">
        <div class="fixed inset-0 bg-black/50 transition-opacity" (click)="close()"></div>
        <div [class]="panelClass" [style.width]="side === 'bottom' ? null : width">
          <ng-content></ng-content>
        </div>
      </div>
    }
  `,
})
export class SheetComponent {
  @Input() open = false;
  @Input() side: 'left' | 'right' | 'bottom' = 'right';
  @Input() width = '400px';
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) {
      this.close();
    }
  }

  get panelClass(): string {
    if (this.side === 'bottom') {
      // Bottom sheet: full-width, anchored to the bottom edge, rounded top,
      // capped height so tall content scrolls instead of covering the screen.
      return cn(
        'fixed bottom-0 left-0 w-full max-h-[85vh] bg-card shadow-lg z-50',
        'transition-transform overflow-y-auto rounded-t-2xl'
      );
    }
    // max-w-[100vw] clamps the inline `width` (e.g. support's 460px) so the
    // side sheet never overflows phones narrower than that width.
    return cn(
      'fixed top-0 h-full bg-card shadow-lg z-50 transition-transform overflow-y-auto max-w-[100vw]',
      this.side === 'right' ? 'right-0' : 'left-0'
    );
  }

  close(): void {
    this.open = false;
    this.closed.emit();
  }
}
