import { InboxNotification } from '../../_models/app.models';

/**
 * Reading and wording the in-app inbox (SHELL-FINISH-00, PR 5). Pure, so the
 * page, the specs and any later surface agree on one reading.
 */

export interface InboxPage {
  items: InboxNotification[];
  unread: number;
}

/** What one row says, and where tapping it goes. */
export interface InboxRowView {
  title: string;
  detail: string;
  icon: 'review' | 'sold-out' | 'paused' | 'resumed' | 'waiting' | 'generic';
  /** Router target for a row that leads somewhere, else null. */
  link: { path: string; queryParams?: Record<string, string> } | null;
}

/**
 * The list response's `data`, or null when it cannot be read. An unreadable
 * answer is an error, never an empty inbox: "You're all caught up" is a claim
 * the server has to have made.
 */
export function readInboxPage(body: unknown): InboxPage | null {
  const data = (body as any)?.data;
  if (!data || typeof data !== 'object') return null;
  const { results, unread_count } = data as { results?: unknown; unread_count?: unknown };
  if (!Array.isArray(results)) return null;
  if (typeof unread_count !== 'number' || !Number.isInteger(unread_count) || unread_count < 0) return null;
  const items: InboxNotification[] = [];
  for (const row of results) {
    const item = readRow(row);
    if (!item) return null;
    items.push(item);
  }
  return { items, unread: unread_count };
}

function readRow(row: unknown): InboxNotification | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || !r['id']) return null;
  if (typeof r['kind'] !== 'string') return null;
  if (typeof r['occurred_at'] !== 'string' || Number.isNaN(Date.parse(r['occurred_at']))) return null;
  if (typeof r['read'] !== 'boolean') return null;
  const payload = r['payload'];
  const actor = r['actor_name'];
  return {
    id: r['id'],
    kind: r['kind'],
    module: typeof r['module'] === 'string' ? r['module'] : '',
    occurred_at: r['occurred_at'],
    read: r['read'],
    payload: payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown> : {},
    actor_name: typeof actor === 'string' && actor.trim() ? actor.trim() : null,
  };
}

/** The review queue a low-review notification opens. */
export const REVIEW_ATTENTION_LINK = { path: '/reviews/feed', queryParams: { view: 'attention' } };

/**
 * The floor's service view (Step 2), where staff Confirm a held round. The Tables
 * page reads `view=service` once, on load (`TablesComponent`).
 */
export const FLOOR_SERVICE_LINK = { path: '/dining-tables', queryParams: { view: 'service' } };

/**
 * `round_waiting` (Step 2, BE-G): ONE row per restaurant that re-alerts when a new
 * round starts waiting. Its payload is `{waiting, oldest_held_since, latest_table}`
 * and carries no diner data. `waiting` decides the words; a `waiting` that is not
 * a whole number of 0 or more is a MALFORMED payload and gets neutral words with
 * the link, never a guessed count. `latest_table` is shown only when it is a
 * non-empty string; anything else simply leaves it out.
 */
function describeRoundWaiting(payload: Record<string, unknown>): InboxRowView {
  const waiting = payload['waiting'];
  if (typeof waiting !== 'number' || !Number.isInteger(waiting) || waiting < 0) {
    return {
      title: 'Orders waiting for staff',
      detail: 'Open the floor view.',
      icon: 'waiting',
      link: FLOOR_SERVICE_LINK,
    };
  }
  if (waiting === 0) {
    return {
      title: 'No orders waiting',
      detail: 'Every waiting order has been handled.',
      icon: 'waiting',
      link: null,
    };
  }
  const table = typeof payload['latest_table'] === 'string' ? (payload['latest_table'] as string).trim() : '';
  const one = waiting === 1;
  return {
    title: one ? '1 order waiting for staff' : `${waiting} orders waiting for staff`,
    detail: (one ? 'Confirm it on the floor view.' : 'Confirm them on the floor view.')
      + (table ? ` Latest: ${table}.` : ''),
    icon: 'waiting',
    link: FLOOR_SERVICE_LINK,
  };
}

/**
 * The words for one notification, built from its kind and payload. A kind this
 * build does not know still renders, neutrally, rather than disappearing.
 */
export function describeNotification(n: InboxNotification): InboxRowView {
  const by = n.actor_name ? ` by ${n.actor_name}` : '';
  switch (n.kind) {
    case 'review_low': {
      const rating = n.payload['rating'];
      const stars = typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5
        ? `${rating}-star` : 'low';
      return {
        title: `New ${stars} review`,
        detail: 'It needs your attention.',
        icon: 'review',
        link: REVIEW_ATTENTION_LINK,
      };
    }
    case 'item_sold_out': {
      const name = typeof n.payload['item_name'] === 'string' && (n.payload['item_name'] as string).trim()
        ? (n.payload['item_name'] as string).trim() : 'A dish';
      return {
        title: `${name} is sold out`,
        detail: `Marked sold out on the kitchen board${by}.`,
        icon: 'sold-out',
        link: null,
      };
    }
    case 'ordering_paused':
      return {
        title: 'Ordering paused',
        detail: `Diners can't place new orders. Paused${by}.`,
        icon: 'paused',
        link: null,
      };
    case 'ordering_resumed':
      return {
        title: 'Ordering resumed',
        detail: `Diners can place orders again. Resumed${by}.`,
        icon: 'resumed',
        link: null,
      };
    case 'round_waiting':
      return describeRoundWaiting(n.payload);
    default:
      return { title: 'New notification', detail: '', icon: 'generic', link: null };
  }
}
