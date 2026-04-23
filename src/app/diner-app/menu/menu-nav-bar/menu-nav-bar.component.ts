import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MenuNavStateService } from '../menu-nav-state.service';

@Component({
  selector: 'app-menu-nav-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './menu-nav-bar.component.html',
})
export class MenuNavBarComponent {
  constructor(public navState: MenuNavStateService) {}

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
  }
}
