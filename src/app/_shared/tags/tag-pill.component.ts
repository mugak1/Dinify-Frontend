import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TagColour,
  getTagColourClasses,
  getTagIconSvg,
} from './tag-palette';

/**
 * Renders a single tag as a pill (icon + name in coloured background).
 *
 * Reused by:
 *  - the Preset Tags settings page (rows, live preview in the modal)
 *  - the menu item editor tag selector (PR 3)
 *  - the diner menu card (PR 4)
 *  - the diner filter sheet (PR 5)
 */
@Component({
  selector: 'app-tag-pill',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      [class]="pillClasses"
      [attr.aria-label]="name"
    >
      @if (iconSvg) {
        <span class="inline-flex items-center" [innerHTML]="iconSvg"></span>
      }
      <span class="truncate">{{ name }}</span>
    </span>
  `,
})
export class TagPillComponent {
  @Input({ required: true }) name = '';
  @Input() icon: string | null = null;
  @Input() colour: TagColour | string = 'gray';
  @Input() size: 'sm' | 'md' = 'sm';

  get iconSvg(): string {
    return getTagIconSvg(this.icon);
  }

  get pillClasses(): string {
    const base = 'inline-flex items-center gap-1 rounded-full font-medium max-w-full';
    const sizeClass =
      this.size === 'md'
        ? 'px-3 py-1 text-sm'
        : 'px-2 py-0.5 text-xs';
    return `${base} ${sizeClass} ${getTagColourClasses(this.colour)}`;
  }
}
