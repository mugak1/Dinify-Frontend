import { ChangeDetectionStrategy, Component, ElementRef, Signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TagPillComponent } from 'src/app/_shared/tags';
import { MenuFilterOption, MenuNavStateService } from '../menu-nav-state.service';

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-menu-nav-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, TagPillComponent],
  templateUrl: './menu-nav-bar.component.html',
  // The nav bar is row 2 INSIDE the diner menu's single .menu-banner
  // (src/styles.css), which owns the background, the shadow and the sticky
  // position for the whole banner. So the host carries none of its own: it is a
  // plain, non-sticky block with no background, border or shadow. It used to
  // have an opaque, independently-sticky mode (sticky at a `stickyTop` offset,
  // white with a hairline) for the portal's embedded diner mount, switched off by
  // `frosted`. That mount is retired (EMBED-RETIRE-00), the diner shell always
  // passed `frosted`, and the mode was removed with its inputs.
  host: {
    class: 'block',
  },
})
export class MenuNavBarComponent {

  /** Chips shown in the active-filters row — dietary first, then allergens. */
  activeFilterChips: Signal<MenuFilterOption[]> = computed(() => {
    const dietarySelected = new Set(this.navState.selectedDietary());
    const allergensSelected = new Set(this.navState.selectedAllergens());
    return [
      ...this.navState.dietaryFilterOptions().filter((o) => dietarySelected.has(o.id)),
      ...this.navState.allergenFilterOptions().filter((o) => allergensSelected.has(o.id)),
    ];
  });

  constructor(
    public navState: MenuNavStateService,
    private host: ElementRef<HTMLElement>,
  ) {
    // Whenever the active section changes (from scroll-spy OR from a pill
    // click), bring the matching pill fully into view in the horizontal nav
    // bar. inline:'nearest' makes this a no-op when the pill is already
    // visible; block:'nearest' guards against any vertical page jump.
    effect(() => {
      const id = this.navState.currentSection();
      if (!id) return;
      const pill = this.host.nativeElement.querySelector<HTMLElement>(
        `[data-section-id="${CSS.escape(id)}"]`,
      );
      pill?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    });
  }

  removeUnderscore(x: string): string {
    return x.replace(/_/g, ' ');
  }

  addUnderscore(x: string): string {
    return x.replace(/ /g, '_');
  }

  scrollTo(section: string, _i: number, _event?: Event): void {
    const id = this.addUnderscore(section);
    document.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.navState.setCurrentSection(id);
    this.navState.setPendingClickTarget(id);
  }

  removeFilter(opt: MenuFilterOption): void {
    if (opt.category === 'allergen') {
      this.navState.toggleAllergen(opt.id);
    } else {
      this.navState.toggleDietary(opt.id);
    }
  }

  /**
   * Renders the display name for an active filter chip outside the
   * filter sheet. For allergens, strips a leading "Contains " prefix
   * (case-insensitive) before prepending "No ", so "Contains Gluten"
   * becomes "No Gluten" rather than the grammatically-broken
   * "No Contains Gluten". For dietary tags, returns the name unchanged.
   *
   * Tags without the "Contains " prefix (e.g. a custom allergen named
   * "Shellfish") fall back to a plain "No <name>" composition.
   *
   * NOTE: this is chip-only. The filter sheet itself continues to show
   * the raw tag name ("Contains Gluten") next to its checkbox, which
   * reads correctly in that context — the diner is toggling the
   * statement "contains gluten" on or off.
   */
  chipDisplayName(opt: MenuFilterOption): string {
    if (opt.category !== 'allergen') return opt.name;
    const stripped = opt.name.replace(/^contains\s+/i, '');
    return `No ${stripped}`;
  }
}
