import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NotificationInboxService } from '../notification-inbox.service';

/** The badge shows at most this number, then "9+". */
export const BADGE_CAP = 9;

/** The badge text for a count, or null when there is nothing to show. */
export function badgeText(count: number | null): string | null {
  if (count === null || count <= 0) return null;
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/**
 * The top bar's notifications bell (SHELL-FINISH-00, PR 5). It opens
 * /notifications and shows the unread count for the selected restaurant.
 *
 * It owns the polling's lifetime: polling starts when the bell appears and
 * stops when it goes, so it runs only while the portal shell is on screen
 * (never on the kitchen board). The badge is ink, not brand red: in the portal
 * red means "act", and an unread count is information (colour roles).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-notification-bell',
  standalone: true,
  imports: [RouterLink],
  template: `
    <a routerLink="/notifications"
      data-testid="notification-bell"
      class="relative h-[44px] w-[44px] inline-flex items-center justify-center rounded-md hover:bg-accent transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      [attr.aria-label]="label()"
      >
      <svg aria-hidden="true" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      @if (badge(); as text) {
        <span aria-hidden="true" data-testid="notification-badge"
          class="absolute top-[6px] right-[4px] min-w-[18px] h-[18px] px-1 rounded-full bg-foreground text-background text-micro font-semibold leading-[18px] text-center"
          >{{ text }}</span>
      }
    </a>
  `,
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  readonly badge = computed(() => badgeText(this.inbox.unreadCount()));

  /** The accessible name carries the real count; the badge is decoration. */
  readonly label = computed(() => {
    const count = this.inbox.unreadCount();
    if (!count) return 'Notifications';
    return `Notifications, ${count} unread`;
  });

  constructor(private inbox: NotificationInboxService) {}

  ngOnInit(): void {
    this.inbox.start();
  }

  ngOnDestroy(): void {
    this.inbox.stop();
  }
}
