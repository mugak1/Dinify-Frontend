import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

/**
 * Kitchen shell / host. Standalone so the root router can reference it directly
 * without an AppModule declaration (keeps app-routing the only edited existing
 * file). Scopes the dark high-contrast KDS theme onto its subtree via the
 * `.dark` class (the CSS vars defined in styles.css) — it does NOT toggle global
 * dark mode. The board renders into the router-outlet.
 */
@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './kitchen.component.html',
  styleUrls: ['./kitchen.component.css'],
})
export class KitchenComponent {}
