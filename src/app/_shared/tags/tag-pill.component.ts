import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  TagColour,
  getTagColourClasses,
  getTagIconDiscClasses,
  getTagIconSvg,
} from './tag-palette';

/**
 * Renders a single tag as a pill: the icon sits inside a small solid-colour
 * disc, on a soft tinted background with a subtle inset ring, with the label
 * in a readable dark shade of the tag's colour. Tone is entirely data-driven
 * — the `colour`/`icon` the backend serves per tag drive every class; there is
 * no name→tone inference here.
 *
 * Reused by:
 *  - the Preset Tags settings page (rows, live preview in the modal)
 *  - the menu item editor tag selector + diner filter sheet / nav chips
 *  - the diner menu card, diner item-detail, and the portal preview drawer
 *  - the portal menu item list (dense `sm` variant)
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
      @if (iconHtml) {
        <span
          class="inline-flex items-center justify-center rounded-full shrink-0"
          [ngClass]="iconDiscClasses"
          [innerHTML]="iconHtml"
        ></span>
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

  constructor(private readonly sanitizer: DomSanitizer) {}

  private iconKey: string | null = null;
  private trustedIcon: SafeHtml | null = null;

  /** Raw catalog SVG string for the served icon ('' when unmapped). */
  get iconSvg(): string {
    return getTagIconSvg(this.icon);
  }

  /**
   * Trusted icon markup for `[innerHTML]`. The SVG is sourced from the fixed
   * internal `TAG_ICONS` catalog (never user input), so bypassing the HTML
   * sanitiser is safe — and necessary, since Angular's sanitiser strips raw
   * `<svg>`. Memoised on `icon` so the reference is stable across change
   * detection. Null (and so no disc) when the icon is absent or unmapped.
   */
  get iconHtml(): SafeHtml | null {
    const svg = this.iconSvg;
    if (!svg) {
      this.iconKey = null;
      this.trustedIcon = null;
      return null;
    }
    if (this.icon !== this.iconKey) {
      this.iconKey = this.icon;
      this.trustedIcon = this.sanitizer.bypassSecurityTrustHtml(svg);
    }
    return this.trustedIcon;
  }

  /**
   * Pill-body classes. A 14px root makes rem utilities resolve at 87.5%, so
   * layout-feeding values are explicit `px`. Left padding tightens when an
   * icon disc is present (the disc supplies the visual left weight).
   */
  get pillClasses(): string {
    const base =
      'inline-flex items-center rounded-full font-semibold max-w-full';
    const hasIcon = !!this.iconSvg;
    const layout =
      this.size === 'md'
        ? `gap-[7px] py-[7px] text-[13.5px] ${hasIcon ? 'pl-[9px] pr-[13px]' : 'px-[13px]'}`
        : `gap-[5px] py-[3px] text-[12px] ${hasIcon ? 'pl-[5px] pr-[10px]' : 'px-[10px]'}`;
    return `${base} ${layout} ${getTagColourClasses(this.colour)}`;
  }

  /**
   * Icon-disc classes — size + solid colour fill + white glyph. The served
   * icon SVGs are a fixed 16px; `[&>svg]` shrinks the glyph so it sits cleanly
   * inside the disc.
   */
  get iconDiscClasses(): string {
    const geometry =
      this.size === 'md'
        ? 'h-[19px] w-[19px] [&>svg]:h-[12px] [&>svg]:w-[12px]'
        : 'h-[16px] w-[16px] [&>svg]:h-[10px] [&>svg]:w-[10px]';
    return `${geometry} ${getTagIconDiscClasses(this.colour)}`;
  }
}
