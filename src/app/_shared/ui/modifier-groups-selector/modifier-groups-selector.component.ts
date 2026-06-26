import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModifierGroup } from 'src/app/_models/app.models';
import { selectionConstraintPhrase } from 'src/app/_common/utils/modifier-utils';

export interface ModifierSingleSelectEvent {
  groupId: string;
  choiceId: string;
}
export interface ModifierMultiToggleEvent {
  groupId: string;
  choiceId: string;
  checked: boolean;
  maxSelections: number;
}

/**
 * Shared, presentational modifier-groups selector — the single source of truth for the
 * single/multi choice UI on BOTH the live diner item-detail route and the restaurant-portal
 * preview drawer (which mirrors it). Renders the diner's canonical look: red radio/checkbox
 * controls, a shared `selectionConstraintPhrase` hint, opacity-disabling of over-cap choices,
 * the "N of M selected" counter, and an inline red error per group.
 *
 * Pure: it holds NO selection state and runs NO validation. The host owns the selection map +
 * validation, feeds `selected` + `errors`, and the component emits intent only. Each group
 * keeps its `mod-group-<id>` DOM id so the diner route's scroll-to-first-unmet still works.
 */
@Component({
  selector: 'app-modifier-groups-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modifier-groups-selector.component.html',
})
export class ModifierGroupsSelectorComponent {
  @Input() groups: ModifierGroup[] = [];
  /** Current selection: group id → selected choice ids. */
  @Input() selected: Record<string, string[]> = {};
  /** Inline error text per group id (empty/absent → no error). Host-gated, e.g. after a submit. */
  @Input() errors: Record<string, string> = {};

  @Output() singleSelect = new EventEmitter<ModifierSingleSelectEvent>();
  @Output() multiToggle = new EventEmitter<ModifierMultiToggleEvent>();

  isSelected(groupId: string, choiceId: string): boolean {
    return (this.selected[groupId] || []).includes(choiceId);
  }

  selectedCount(groupId: string): number {
    return (this.selected[groupId] || []).length;
  }

  /** Shared count phrase ("Select 1", "Select up to 3", …) — identical wording on both surfaces. */
  constraintLabel(group: ModifierGroup): string {
    return selectionConstraintPhrase(group.minSelections, group.maxSelections);
  }
}
