import { Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, merge } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

/**
 * App-wide network status, driven by the browser's own connectivity signal.
 *
 * Offline is a *status*, not an error: it is seeded from `navigator.onLine` and
 * kept current by the window `online`/`offline` events. This is the single
 * source of that status, shared by the diner offline strip and the back-office
 * (restaurant/admin) offline banner.
 *
 * Deliberately NOT the kitchen's `ConnectionState`, which is poll-derived (it
 * infers link health from request outcomes). Surfaces with no background poll
 * to derive from use `navigator.onLine` + its events as the right primitive.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  /** Short settle window so a flapping radio doesn't flicker the offline UI. */
  private static readonly DEBOUNCE_MS = 400;

  private readonly _offline = signal(this.readOffline());

  /** True while the browser reports no network connection. */
  readonly isOffline = this._offline.asReadonly();

  constructor() {
    // Collapse a burst of transitions to its final state, then re-read
    // navigator.onLine as the source of truth at settle time.
    merge(fromEvent(window, 'online'), fromEvent(window, 'offline'))
      .pipe(debounceTime(ConnectivityService.DEBOUNCE_MS), takeUntilDestroyed())
      .subscribe(() => this._offline.set(this.readOffline()));
  }

  private readOffline(): boolean {
    return typeof navigator !== 'undefined' ? !navigator.onLine : false;
  }
}
