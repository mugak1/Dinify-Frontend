import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PriceDisplayComponent } from '../price-display/price-display.component';

export interface ExtraOption {
  id: string;
  name: string;
  /** Effective ("now") price. Equals originalPrice when not discounted. */
  effectivePrice: number;
  originalPrice: number;
  isDiscounted: boolean;
}

/**
 * Shared, presentational extras ("Add Extras") selector — the single source of truth for the
 * extras checkbox list on BOTH the diner item-detail route and the preview drawer. Renders the
 * diner's canonical look: red checkboxes, the struck/effective price for discounted extras via
 * app-price-display, the "N of M selected" counter, and an inline error.
 *
 * Pure: host owns selection + validation and feeds host-normalised rows; the component emits a
 * toggled extra id only. The optional `anchorId` keeps the diner route's `extras-section`
 * scroll target intact.
 */
@Component({
  selector: 'app-extras-selector',
  standalone: true,
  imports: [CommonModule, PriceDisplayComponent],
  templateUrl: './extras-selector.component.html',
})
export class ExtrasSelectorComponent {
  /** Host-normalised extra rows (id/name + already-resolved prices). */
  @Input() extras: ExtraOption[] = [];
  @Input() selectedIds: string[] = [];
  /** 0 (or <1) means no ceiling — never disables choices, never shows the counter. */
  @Input() maxSelections = 0;
  @Input() required = false;
  /** Shared count phrase, e.g. "Select up to 3" ('' renders no line). */
  @Input() constraintLabel = '';
  /** Inline error text ('' renders no line). Host-gated, e.g. after a submit. */
  @Input() error = '';
  /** Optional DOM id (the diner route scrolls to 'extras-section' on a blocked add). */
  @Input() anchorId: string | null = null;

  /** Emits the toggled extra's id. Named `toggled` (not `toggle`) to avoid colliding with the
   *  native DOM `toggle` event. */
  @Output() toggled = new EventEmitter<string>();

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  get atMax(): boolean {
    return this.maxSelections > 0 && this.selectedIds.length >= this.maxSelections;
  }
}
