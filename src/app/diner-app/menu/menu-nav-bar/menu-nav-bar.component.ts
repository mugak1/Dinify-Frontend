import { Component, ElementRef, Input, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MenuNavStateService } from '../menu-nav-state.service';

@Component({
  selector: 'app-menu-nav-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './menu-nav-bar.component.html',
  host: {
    class: 'block sticky z-40 bg-white border-b border-gray-200',
    '[style.top]': 'stickyTop',
  },
})
export class MenuNavBarComponent implements OnInit {
  @Input() stickyTop: string = '49px';

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

  ngOnInit(): void {
    const px = parseInt(this.stickyTop, 10);
    this.navState.setStickyTopPx(Number.isFinite(px) ? px : 49);
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
}
