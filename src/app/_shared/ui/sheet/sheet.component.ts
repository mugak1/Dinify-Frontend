import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { cn } from '../../utils/cn';
import { autoNameOverlayPanel } from '../dialog/dialog.component';

@Component({
  selector: 'app-dn-sheet',
  standalone: true,
  imports: [A11yModule],
  // Same focus-trap/return + container-focus pattern as app-dn-dialog: the
  // wrapper traps and auto-captures, cdkFocusInitial on the panel makes the sheet
  // container the initial focus target. The panel already caps height/scrolls.
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50" cdkTrapFocus cdkTrapFocusAutoCapture>
        <div class="fixed inset-0 bg-black/50 transition-opacity" (click)="close()"></div>
        <div
          #panel
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          cdkFocusInitial
          [attr.aria-label]="ariaLabel || null"
          [class]="panelClass"
          [style.width]="side === 'bottom' ? null : width"
        >
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
  /** Accessible name — see DialogComponent. Opt-in; wired to consumers in the follow-up pass. */
  @Input() ariaLabelledby?: string;
  @Input() ariaLabel?: string;
  @Output() closed = new EventEmitter<void>();

  // Names the panel from its first heading when the sheet opens (see DialogComponent).
  @ViewChild('panel') set panel(ref: ElementRef<HTMLElement> | undefined) {
    if (ref) {
      autoNameOverlayPanel(ref.nativeElement, this.ariaLabelledby, this.ariaLabel);
    }
  }

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
