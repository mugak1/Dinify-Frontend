import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-diner-footer',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './diner-footer.component.html'
})
export class DinerFooterComponent {
  readonly currentYear = new Date().getFullYear();
}
