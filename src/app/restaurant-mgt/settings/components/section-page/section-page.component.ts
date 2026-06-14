import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import {
  SettingsIconComponent,
  SettingsIconName,
} from '../settings-icon/settings-icon.component';

export type SectionPageState = 'ready' | 'loading' | 'error' | 'empty';

/**
 * Shared scaffold for every Settings section. Provides the consistent chrome —
 * back-to-hub affordance, section header (Gabarito title via the
 * `app-restaurant-mgt h1` selector), optional `[section-actions]` slot, reusable
 * loading/error/empty states, and a sticky save bar — so individual sections
 * only supply their body. Standalone; added to `RestaurantMgtModule.imports`
 * so both standalone and module-declared sections can reuse it.
 *
 * The save bar uses an explicit `h-[64px]` (see template): the app sets
 * `html{font-size:14px}`, so rem-based heights render at 87.5% and would drift
 * against the matching `pb-[64px]` content reserve. Literal px keeps them in lockstep.
 */
@Component({
  selector: 'app-settings-section-page',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonComponent, SettingsIconComponent],
  templateUrl: './section-page.component.html',
})
export class SectionPageComponent {
  /** Section title shown in the header (rendered as <h1>, Gabarito by selector). */
  @Input() title = '';
  /** Optional one-line description under the title. */
  @Input() description = '';
  /** Optional section icon shown beside the title. */
  @Input() icon: SettingsIconName | '' = '';

  /** Which state to render in the body region. Defaults to projecting content. */
  @Input() state: SectionPageState = 'ready';

  /** Copy for the error state. */
  @Input() errorMessage = "We couldn't load this section.";

  /** Copy for the empty / coming-soon state. */
  @Input() emptyTitle = 'Nothing here yet';
  @Input() emptyMessage = '';

  /** Unsaved-changes flag — drives the sticky save bar and the content reserve. */
  @Input() dirty = false;
  /** Save-in-flight flag — disables the save bar while a save is pending. */
  @Input() saving = false;

  @Output() save = new EventEmitter<void>();
  @Output() discard = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
}
