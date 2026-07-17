import { Component, HostListener } from '@angular/core';

import { TagPillComponent } from 'src/app/_shared/tags';
import { MenuNavStateService } from '../menu-nav-state.service';

/**
 * Diner-side category-aware filter sheet. Surfaces the tags actually
 * present on loaded menu items (and marked filterable in the preset
 * catalog), grouped into dietary preferences and allergens-to-avoid.
 *
 * Filtering is live: each tap toggles a tag id on `MenuNavStateService`
 * and re-runs the pure `filterMenuItems` helper, so the menu underneath
 * updates instantly. No Apply step — only a Clear at the top.
 */
@Component({
  selector: 'app-diner-tag-filter-sheet',
  standalone: true,
  imports: [TagPillComponent],
  templateUrl: './diner-tag-filter-sheet.component.html',
})
export class DinerTagFilterSheetComponent {
  constructor(public navState: MenuNavStateService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.navState.showTagFilter()) {
      this.navState.closeTagFilter();
    }
  }
}
