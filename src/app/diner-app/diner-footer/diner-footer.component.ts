import { ChangeDetectionStrategy, Component } from '@angular/core';

import { RouterModule } from '@angular/router';

@Component({
  changeDetection: ChangeDetectionStrategy.Default,
  selector: 'app-diner-footer',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './diner-footer.component.html'
})
export class DinerFooterComponent {
  readonly currentYear = new Date().getFullYear();
}
