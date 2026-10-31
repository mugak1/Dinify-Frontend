import { HttpContext } from '@angular/common/http';
import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription, timeout } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { SILENT_FAILURE } from '../../_helpers/error.interceptor';
import { ApiService } from '../../_services/api.service';
import { AuthenticationService } from '../../_services/authentication.service';

/** How often the bell asks for the unread count while the tab is visible. */
export const INBOX_POLL_MS = 60_000;
/** A count request that takes longer than this is abandoned (and the last count kept). */
export const INBOX_TIMEOUT_MS = 10_000;

export const UNREAD_COUNT_PATH = 'notifications/inbox/unread-count/';

/**
 * The unread count behind the top bar's bell (SHELL-FINISH-00, PR 5).
 *
 * WHEN IT ASKS. Every `INBOX_POLL_MS` while the tab is visible; nothing while it
 * is hidden; once straight away when it becomes visible again; and whenever
 * `refresh()` is called (the Notifications page calls it after a read). The bell
 * starts and stops it, so it runs only while the portal shell is on screen.
 *
 * ONE REQUEST AT A TIME. A refresh asked for while one is in flight is not sent
 * beside it: it is remembered and sent once the first settles, because the first
 * may have been answered before the read it should reflect. Each request is
 * bounded by `INBOX_TIMEOUT_MS`, so requests made while the server is off cannot
 * stack up.
 *
 * A FAILED POLL IS SILENT AND KEEPS THE LAST COUNT. The request carries
 * `SILENT_FAILURE`, so the error interceptor shows no toast (401 renewal still
 * runs), and an unreadable answer is ignored rather than read as zero.
 *
 * IT NEVER RESETS THE IDLE-LOGOUT TIMER. Idle logout counts only mouse, key,
 * touch and scroll input (`InactivityService`); this does none of those, and it
 * must not be taught to, or the bell would keep an unattended portal signed in.
 *
 * The count is for the restaurant selected at login (`rest_role`). Switching
 * restaurant reloads the document, so this never holds another venue's count.
 */
@Injectable({ providedIn: 'root' })
export class NotificationInboxService implements OnDestroy {
  /** The last count the server gave, or null before the first answer. */
  readonly unreadCount = signal<number | null>(null);

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Subscription | null = null;
  private busy = false;
  private pending = false;

  constructor(private api: ApiService, private auth: AuthenticationService) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (this.visible()) {
      this.refresh();
      this.startTimer();
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopTimer();
    this.pending = false;
    this.inFlight?.unsubscribe();
    this.inFlight = null;
    this.busy = false;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /** Ask for the count now (or as soon as the request in flight settles). */
  refresh(): void {
    if (this.busy) {
      this.pending = true;
      return;
    }
    const restaurant = this.auth.currentRestaurantRole?.restaurant_id;
    if (!restaurant) return;
    this.busy = true;
    this.pending = false;
    this.inFlight = this.api
      .get<{ unread_count: number }>(null, UNREAD_COUNT_PATH, { restaurant }, undefined,
        new HttpContext().set(SILENT_FAILURE, true))
      .pipe(
        timeout(INBOX_TIMEOUT_MS),
        finalize(() => {
          this.busy = false;
          this.inFlight = null;
          if (this.pending && this.running) {
            this.pending = false;
            this.refresh();
          }
        }),
      )
      .subscribe({
        next: (res) => this.accept((res as any)?.data?.unread_count),
        // Silent by design: the last count stays on the bell.
        error: () => undefined,
      });
  }

  /** A count the caller already holds (the page's list response carries one). */
  setCount(count: unknown): void {
    this.accept(count);
  }

  private accept(count: unknown): void {
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
      this.unreadCount.set(count);
    }
  }

  private visible(): boolean {
    return document.visibilityState !== 'hidden';
  }

  private onVisibility = (): void => {
    if (!this.running) return;
    if (this.visible()) {
      this.refresh();
      this.startTimer();
    } else {
      this.stopTimer();
    }
  };

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.refresh(), INBOX_POLL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
