import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ConnectivityService } from '../../_services/connectivity.service';

/**
 * Ambient "you're offline" status strip for the diner shell. Calm (amber, not
 * the alarm-red of a hard error) because offline is a *status*: the diner can
 * keep browsing and building a basket — only placing the order needs the
 * network (surfaced inline at the checkout button, not here).
 *
 * Self-gating: renders nothing while online, so the shell mounts it
 * unconditionally. The host is `display: contents`, so when hidden it adds
 * nothing to the shell's flex column; when shown, the inner strip pins directly
 * under the 48px brand strip and stays visible while scrolling.
 */
@Component({
  selector: 'app-offline-strip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './offline-strip.component.html',
  host: { class: 'contents' },
})
export class OfflineStripComponent {
  readonly connectivity = inject(ConnectivityService);
}
