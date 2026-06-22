import { Component, Input, Output, EventEmitter } from '@angular/core';
import { cn } from '../../utils/cn';

export type SwitchSize = 'sm' | 'md';

@Component({
  selector: 'app-dn-switch',
  standalone: true,
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked"
      [disabled]="disabled"
      [class]="trackClass"
      (click)="toggle()"
    >
      <span [class]="thumbClass"></span>
    </button>
  `,
})
export class SwitchComponent {
  @Input() checked = false;
  @Input() size: SwitchSize = 'md';
  /** Renders the track non-interactive (used e.g. for the locked owner row in the roles grid). */
  @Input() disabled = false;
  @Output() checkedChange = new EventEmitter<boolean>();

  get trackClass(): string {
    // `border-2 border-transparent` is load-bearing (keeps the track height in
    // lockstep with the thumb) — preserve it. Cursor/opacity are state-aware so
    // a disabled track reads as locked.
    const base = 'inline-flex shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
    const sizeClass = this.size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
    const stateClass = this.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer';
    return cn(base, sizeClass, stateClass, this.checked ? 'bg-primary' : 'bg-input');
  }

  get thumbClass(): string {
    const base = 'pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform';
    const sizeClass = this.size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const translate = this.checked
      ? (this.size === 'sm' ? 'translate-x-4' : 'translate-x-5')
      : 'translate-x-0';
    return cn(base, sizeClass, translate);
  }

  toggle(): void {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.checkedChange.emit(this.checked);
  }
}
