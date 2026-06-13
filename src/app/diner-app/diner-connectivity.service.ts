import { Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, merge } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

/**
 * Diner-side network status, driven by the browser's own connectivity signal.
 *
 * Offline is a *status*, not an error: the diner can browse and build a basket
 * entirely client-side — only *sending* the order needs the network. This
 * service is the single source of that status, seeded from `navigator.onLine`
 * and kept current by the window `online`/`offline` events.
 *
 * Deliberately NOT the kitchen's `ConnectionState`, which is poll-derived (it
 * infers link health from request outcomes). The diner has no background poll
 * to derive from, so `navigator.onLine` + its events is the right primitive.
 */
@Injectable({ providedIn: 'root' })
export class DinerConnectivityService {
  /** Short settle window so a flapping radio doesn't flicker the offline strip. */
  private static readonly DEBOUNCE_MS = 400;

  private readonly _offline = signal(this.readOffline());

  /** True while the browser reports no network connection. */
  readonly isOffline = this._offline.asReadonly();

  constructor() {
    // Collapse a burst of transitions to its final state, then re-read
    // navigator.onLine as the source of truth at settle time.
    merge(fromEvent(window, 'online'), fromEvent(window, 'offline'))
      .pipe(debounceTime(DinerConnectivityService.DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe(() => this._offline.set(this.readOffline()));
  }

  private readOffline(): boolean {
    return typeof navigator !== 'undefined' ? !navigator.onLine : false;
  }
}
