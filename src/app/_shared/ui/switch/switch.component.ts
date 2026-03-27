import { Component, Input, Output, EventEmitter } from '@angular/core';
import { cn } from '../../utils/cn';

@Component({
  selector: 'dn-switch',
  standalone: true,
  template: `
    <button
      type="button"
      role="switch"
      [attr.aria-checked]="checked"
      [class]="trackClass"
      (click)="toggle()"
    >
      <span [class]="thumbClass"></span>
    </button>
  `,
})
export class SwitchComponent {
  @Input() checked = false;
  @Output() checkedChange = new EventEmitter<boolean>();

  get trackClass(): string {
    return cn(
      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      this.checked ? 'bg-primary' : 'bg-input'
    );
  }

  get thumbClass(): string {
    return cn(
      'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
      this.checked ? 'translate-x-4' : 'translate-x-0.5'
    );
  }

  toggle(): void {
    this.checked = !this.checked;
    this.checkedChange.emit(this.checked);
  }
}
