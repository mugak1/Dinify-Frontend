import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { InactivityService } from '../_services/inactivity.service';

/**
 * Kitchen shell / host. Standalone so the root router can reference it directly
 * without an AppModule declaration (keeps app-routing the only edited existing
 * file). Scopes the dark high-contrast KDS theme onto its subtree via the
 * `.dark` class (the CSS vars defined in styles.css) — it does NOT toggle global
 * dark mode. The board renders into the router-outlet.
 *
 * It also SUSPENDS IDLE LOGOUT for as long as it is mounted. The board is a
 * display that nobody touches during a quiet spell, and the 15-minute idle
 * logout used to sign it out and stop it showing orders. The hold is released
 * on destroy, so leaving /kitchen restores idle logout with a fresh window.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-kitchen',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './kitchen.component.html',
  styleUrls: ['./kitchen.component.css'],
})
export class KitchenComponent implements OnDestroy {
  private readonly releaseIdleLogout = inject(InactivityService).suspend();

  ngOnDestroy(): void {
    this.releaseIdleLogout();
  }
}
