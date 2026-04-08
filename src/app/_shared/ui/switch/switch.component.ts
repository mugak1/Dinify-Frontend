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
  @Output() checkedChange = new EventEmitter<boolean>();

  get trackClass(): string {
    const base = 'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    const sizeClass = this.size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
    return cn(base, sizeClass, this.checked ? 'bg-primary' : 'bg-input');
  }

  get thumbClass(): string {
    const base = 'pointer-events-none block rounded-full bg-white shadow-sm transition-transform';
    const sizeClass = this.size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const translate = this.checked
      ? (this.size === 'sm' ? 'translate-x-4' : 'translate-x-5')
      : 'translate-x-0.5';
    return cn(base, sizeClass, translate);
  }

  toggle(): void {
    this.checked = !this.checked;
    this.checkedChange.emit(this.checked);
  }
}
