import { HttpContext } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { SILENT_FAILURE } from 'src/app/_helpers/error.interceptor';
import { InboxNotification } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';
import { NotificationInboxService } from '../layout/notification-inbox.service';
import { InboxRowView, describeNotification, readInboxPage } from './inbox-notification';

type NotifState = 'loading' | 'ready' | 'error' | 'empty';

export const INBOX_PATH = 'notifications/inbox/';
export const READ_ALL_PATH = 'notifications/inbox/read-all/';
export function readOnePath(id: string): string {
  return `notifications/inbox/${encodeURIComponent(id)}/read/`;
}

/**
 * Restaurant-portal Notifications, on the in-app inbox (SHELL-FINISH-00, PR 5).
 *
 * It used to read the MongoDB `notifications` collection, which the server
 * cannot reach, so it could never fill. It now reads `notifications/inbox/` for
 * the restaurant selected at login: the operational events PR 4 records (a low
 * review, a dish sold out from the kitchen board, ordering paused or resumed).
 * The server decides what this user may see; this page only renders it.
 *
 * Four states: loading, empty, error with Retry, and ready. An unreadable
 * answer is an error, never "all caught up". The load carries `SILENT_FAILURE`
 * because the page reports its own failure inline, so the operator gets one
 * message, not a toast beside the error card. Reads are the operator's own
 * action, so their failures still toast.
 *
 * Reading a row marks it read at once and keeps the bell in step; a failed read
 * puts the row back as unread. A low-review row opens the review queue.
 */
@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-rest-notifications',
    templateUrl: './rest-notifications.component.html',
    styleUrl: './rest-notifications.component.css',
    standalone: false
})
export class RestNotificationsComponent implements OnInit, OnDestroy {
  items: InboxNotification[] = [];
  unreadCount = 0;
  state: NotifState = 'loading';
  markingAll = false;

  private loadSub: Subscription | null = null;
  /** Moves whenever an answer settles every row at once (a bulk read, a load). */
  private readEpoch = 0;
  private views = new Map<string, InboxRowView>();

  constructor(
    private api: ApiService,
    private auth: AuthenticationService,
    private inbox: NotificationInboxService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
  }

  private get restaurantId(): string | undefined {
    return this.auth.currentRestaurantRole?.restaurant_id;
  }

  load(): void {
    this.loadSub?.unsubscribe();
    this.state = 'loading';
    const restaurant = this.restaurantId;
    if (!restaurant) {
      this.state = 'error';
      return;
    }
    this.loadSub = this.api
      .get(null, INBOX_PATH, { restaurant }, undefined, new HttpContext().set(SILENT_FAILURE, true))
      .subscribe({
        next: (body) => {
          const page = readInboxPage(body);
          if (!page) {
            this.state = 'error';
            return;
          }
          this.readEpoch++;
          this.items = page.items;
          this.unreadCount = page.unread;
          this.views = new Map(page.items.map((n) => [n.id, describeNotification(n)]));
          this.inbox.setCount(page.unread);
          this.state = page.items.length ? 'ready' : 'empty';
        },
        error: () => {
          this.state = 'error';
        },
      });
  }

  view(n: InboxNotification): InboxRowView {
    return this.views.get(n.id) ?? describeNotification(n);
  }

  /** Tap a row: mark it read, then follow its link if it has one. */
  open(n: InboxNotification): void {
    if (!n.read) this.markRead(n);
    const link = this.view(n).link;
    if (link) {
      this.router.navigate([link.path], { queryParams: link.queryParams });
    }
  }

  markRead(n: InboxNotification): void {
    if (n.read) return;
    n.read = true;
    this.adjustUnread(-1);
    const epoch = this.readEpoch;
    this.api.postPatch(readOnePath(n.id), {}, 'post').subscribe({
      next: () => this.inbox.refresh(),
      error: () => {
        // The interceptor reports it; put the row back so it is not lost. Not
        // when a newer answer has settled the rows since (a bulk read or a
        // reload): this failure is then stale, and undoing it would mark
        // unread a row the server has already marked read.
        if (epoch !== this.readEpoch) return;
        n.read = false;
        this.adjustUnread(+1);
      },
    });
  }

  markAllRead(): void {
    const restaurant = this.restaurantId;
    if (!restaurant || this.markingAll || this.unreadCount === 0) return;
    this.markingAll = true;
    this.api.postPatch(READ_ALL_PATH, {}, 'post', undefined, { restaurant }).subscribe({
      next: () => {
        this.markingAll = false;
        this.readEpoch++;
        this.items.forEach((n) => (n.read = true));
        this.unreadCount = 0;
        this.inbox.setCount(0);
        this.inbox.refresh();
      },
      error: () => {
        this.markingAll = false;
      },
    });
  }

  private adjustUnread(delta: number): void {
    this.unreadCount = Math.max(0, this.unreadCount + delta);
    this.inbox.setCount(this.unreadCount);
  }
}
