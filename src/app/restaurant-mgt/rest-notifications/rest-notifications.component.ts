import { Component, OnInit } from '@angular/core';
import { ApiResponse, NotificationItem } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

type NotifState = 'loading' | 'ready' | 'error' | 'empty';

/**
 * Restaurant-portal Notifications. Rebuilt off the legacy CoreUI "email widget"
 * (`app-common-notifications`, still used by dinify-mgt) onto the portal
 * primitives — a real <h1>, cards, an unread badge, and an honest
 * loading/ready/error/empty state machine (the legacy widget's `isLoading` was
 * never set true, so "no messages" flashed during the first load). The fetch +
 * mark-read contract is ported verbatim.
 */
@Component({
    selector: 'app-rest-notifications',
    templateUrl: './rest-notifications.component.html',
    styleUrl: './rest-notifications.component.css',
    standalone: false
})
export class RestNotificationsComponent implements OnInit {
  notifys: NotificationItem[] = [];
  state: NotifState = 'loading';
  /** The id of the currently-expanded row, or null (one open at a time). */
  expandedId: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state = 'loading';
    this.api.get<NotificationItem>(null, 'notifications/?skip_archived=True').subscribe({
      next: (e: ApiResponse<any>) => {
        this.notifys = ((e.data as any) as NotificationItem[]) ?? [];
        this.state = this.notifys.length ? 'ready' : 'empty';
      },
      error: () => {
        // The HTTP error interceptor surfaces the message as a toast.
        this.state = 'error';
      },
    });
  }

  toggle(n: NotificationItem): void {
    const opening = this.expandedId !== n._id;
    this.expandedId = opening ? n._id : null;
    if (opening && !n.read) {
      this.markRead(n);
    }
  }

  /** Marks a row read on expand (optimistic — the unread pill clears at once),
   *  mirroring the legacy widget's PUT. */
  private markRead(n: NotificationItem): void {
    n.read = true;
    this.api.postPatch('notifications/', { notification_id: n._id }, 'put').subscribe({
      error: () => { /* interceptor toasts; keep the row read to avoid a flicker */ },
    });
  }

  get unreadCount(): number {
    return this.notifys.filter((n) => !n.read).length;
  }
}
