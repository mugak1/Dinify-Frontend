import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';

export type DialogMaxWidth = 'sm' | 'md' | 'lg';

const maxWidthClasses: Record<DialogMaxWidth, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-xl',
};

// Global counter for auto-stamped heading ids, shared across every dialog/sheet
// instance so concurrently-open overlays never collide.
let overlayTitleUid = 0;

/**
 * Give the modal panel an accessible name. Explicit `ariaLabelledby` / `ariaLabel`
 * inputs win; otherwise the panel's first projected heading becomes the name
 * (its id is stamped if absent). Runs imperatively from a ViewChild setter so it
 * never fights a template binding. Shared by DialogComponent and SheetComponent.
 * Benign failure: a heading-less, label-less overlay simply stays unnamed.
 */
export function autoNameOverlayPanel(
  panel: HTMLElement,
  ariaLabelledby?: string,
  ariaLabel?: string,
): void {
  if (ariaLabelledby) {
    panel.setAttribute('aria-labelledby', ariaLabelledby);
    return;
  }
  if (ariaLabel) return; // aria-label is applied via its own template binding
  const heading = panel.querySelector('h1, h2, h3, h4, h5, h6');
  if (heading) {
    if (!heading.id) {
      heading.id = `dn-overlay-title-${++overlayTitleUid}`;
    }
    panel.setAttribute('aria-labelledby', heading.id);
  }
}

@Component({
  selector: 'app-dn-dialog',
  standalone: true,
  imports: [A11yModule],
  // cdkTrapFocus + cdkTrapFocusAutoCapture (on the wrapper) trap Tab within the
  // modal, auto-focus on open, and restore focus to the trigger when the @if
  // destroys it on close. cdkFocusInitial sits on the PANEL (a descendant of the
  // trap, found via querySelector), so auto-capture focuses the dialog container
  // itself — announced via role/aria, and never a destructive footer button.
  // max-h-[85vh] + overflow-y-auto keep tall forms' footers reachable instead of
  // clipping off short viewports.
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50 flex items-center justify-center" cdkTrapFocus cdkTrapFocusAutoCapture>
        <div class="fixed inset-0 bg-black/50" (click)="onBackdrop()"></div>
        <div
          #panel
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          cdkFocusInitial
          [attr.aria-label]="ariaLabel || null"
          [class]="'relative z-50 bg-card rounded-lg shadow-lg p-6 w-full mx-4 max-h-[85vh] overflow-y-auto ' + maxWidthClass"
        >
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
  /**
   * Accessible name for the dialog. Prefer `ariaLabelledby` pointing at the id of
   * the dialog's heading; use `ariaLabel` for a literal string when there is no
   * heading element. Both are opt-in — consumers are wired in the follow-up pass.
   */
  @Input() ariaLabelledby?: string;
  @Input() ariaLabel?: string;
  @Output() closed = new EventEmitter<void>();
  /**
   * Fires when the user tries to dismiss the dialog (Escape or backdrop) while
   * `disableClose` is true — i.e. the primitive blocked the auto-close. Lets a
   * consumer intercept the attempt (e.g. prompt "discard unsaved changes?")
   * instead of the dismissal being a silent no-op. Consumers that don't bind it
   * keep the existing behaviour (the dialog simply stays open).
   */
  @Output() closeAttempt = new EventEmitter<void>();

  // Fires with the panel ref when the dialog opens (and undefined when the @if
  // destroys it on close). Names the panel from its first heading unless an
  // explicit label input is set.
  @ViewChild('panel') set panel(ref: ElementRef<HTMLElement> | undefined) {
    if (ref) {
      autoNameOverlayPanel(ref.nativeElement, this.ariaLabelledby, this.ariaLabel);
    }
  }

  get maxWidthClass(): string {
    return maxWidthClasses[this.maxWidth] ?? 'max-w-lg';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open) return;
    if (this.disableClose) { this.closeAttempt.emit(); return; }
    this.close();
  }

  onBackdrop(): void {
    if (this.disableClose) { this.closeAttempt.emit(); return; }
    this.close();
  }

  close(): void {
    this.open = false;
    this.closed.emit();
  }
}
