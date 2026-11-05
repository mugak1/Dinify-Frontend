import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { Observable, fromEvent, map } from 'rxjs';

/**
 * Whether the page is visible, and when that changes. The floor view polls only
 * while the tab is visible (decision 5, FE-C): a hidden tab nobody is looking at
 * should not read the floor every five seconds.
 *
 * A token rather than direct `document` reads so a spec can hide and show the page
 * without touching the document Angular renders into. The default is the real one.
 */
export interface FloorPageVisibility {
  /** True while the tab is hidden (`document.visibilityState === 'hidden'`). */
  hidden(): boolean;
  /** Emits on every visibility change. */
  readonly changes: Observable<void>;
}

export const FLOOR_PAGE_VISIBILITY = new InjectionToken<FloorPageVisibility>('FLOOR_PAGE_VISIBILITY', {
  providedIn: 'root',
  factory: () => {
    const doc = inject(DOCUMENT);
    return {
      hidden: () => doc.visibilityState === 'hidden',
      changes: fromEvent(doc, 'visibilitychange').pipe(map(() => undefined)),
    };
  },
});
