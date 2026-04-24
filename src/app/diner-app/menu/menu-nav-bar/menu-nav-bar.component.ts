import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MenuNavStateService } from '../menu-nav-state.service';

@Component({
  selector: 'app-menu-nav-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './menu-nav-bar.component.html',
  styles: [':host { display: block; }'],
})
export class MenuNavBarComponent implements OnInit {
  @Input() stickyTop: string = '49px';

  constructor(public navState: MenuNavStateService) {}

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

  scrollTo(section: string, _i: number): void {
    document
      .querySelector('#' + this.addUnderscore(section))
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.navState.setCurrentSection(this.addUnderscore(section));
  }
}
