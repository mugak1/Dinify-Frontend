import { DOCUMENT } from '@angular/common';
import { HttpContext } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, computed, effect, inject, OnDestroy,
  OnInit, signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import { ApiService } from 'src/app/_services/api.service';
import { Socials } from 'src/app/_models/app.models';
import { formatOrderNumber } from 'src/app/kitchen/services/kitchen-logic';
import { SILENT_FAILURE } from 'src/app/_helpers/error.interceptor';
import { REVIEW_TAG_CHIPS, ReviewTagChip } from 'src/app/_shared/reviews/review-tags';
import {
  DinerRound, DinerRoundState, readCorrelation, readDinerRound,
} from 'src/app/_shared/order/checkout-correlation';

/**
 * Step 2 — diner round state v1. Copy for the two states in which the kitchen
 * does NOT have the order. Released keeps today's markup verbatim in the
 * template, so it has no entry here. None of these strings may mention the
 * kitchen: a held round has not reached it and a declined one never will.
 */
const HELD_COPY = {
  heading: 'Waiting for staff',
  body: 'Waiting for staff to confirm your order.',
  staleBody: 'Still waiting. Please ask a member of staff.',
} as const;
const DECLINED_COPY = {
  heading: 'Order not accepted',
  body: "This order wasn't accepted. Please ask a member of staff.",
} as const;

/** Fixed render order + URL base per network. A stored handle is "username or
 *  full link"; bare usernames are prefixed with the base (TikTok's base carries
 *  the leading @). */
const SOCIAL_NETWORKS: { key: keyof Socials; label: string; base: string }[] = [
  { key: 'instagram', label: 'Instagram', base: 'https://instagram.com/' },
  { key: 'facebook', label: 'Facebook', base: 'https://facebook.com/' },
  { key: 'x', label: 'X', base: 'https://x.com/' },
  { key: 'tiktok', label: 'TikTok', base: 'https://www.tiktok.com/@' },
];

/** Verdict line driven by the overall rating (handoff §3.3) — text + emoji + the
 *  Tailwind colour class. 0 is the muted placeholder (no emoji). */
interface Verdict {
  text: string;
  emoji: string;
  colorClass: string;
}
const VERDICTS: Record<number, Verdict> = {
  0: { text: 'Tap to rate your order', emoji: '', colorClass: 'text-gray-400' },
  1: { text: 'Not great', emoji: '😕', colorClass: 'text-muted-foreground' },
  2: { text: 'Could be better', emoji: '🙂', colorClass: 'text-amber-500' },
  3: { text: 'Pretty good', emoji: '😋', colorClass: 'text-amber-500' },
  4: { text: 'Really enjoyed it', emoji: '😄', colorClass: 'text-green-600' },
  5: { text: 'Loved every bite', emoji: '🤩', colorClass: 'text-green-600' },
};

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-order-complete',
    templateUrl: './order-complete.component.html',
    styleUrl: './order-complete.component.css',
    standalone: false
})
export class OrderCompleteComponent implements OnInit, OnDestroy {
  /** Re-read cadence while the round is held (contract: every 10 seconds). */
  static readonly POLL_MS = 10_000;
  /** Ceiling for the failure back-off (10 → 20 → 40 → 60 s). */
  static readonly MAX_BACKOFF_MS = 60_000;
  /** One read may take this long before it counts as a failure. */
  static readonly READ_TIMEOUT_MS = 10_000;

  /**
   * Step 2 — the round state the server stated, or `null` when it said
   * nothing. Seeded from the SUBMIT REPLY (carried through navigation state,
   * so it survives a reload of this screen) and then from the diner's own
   * order read while the round is held. NULL IS RELEASED: an older backend
   * sends no round, and this screen then renders exactly as it always has.
   */
  readonly round = signal<DinerRound | null>(null);

  /** `held` / `declined` / `released`; absent or unreadable is `released`. */
  readonly roundState = computed<DinerRoundState>(
    () => this.round()?.state ?? 'released');

  /** Heading + body for a held or declined round; `null` when released (the
   *  template's released branch is today's markup, unchanged). Stale is the
   *  SERVER's flag only — never derived from `held_since` and this clock. */
  readonly roundCopy = computed<{ heading: string; body: string } | null>(() => {
    const round = this.round();
    if (round?.state === 'held') {
      return {
        heading: HELD_COPY.heading,
        body: round.stale ? HELD_COPY.staleBody : HELD_COPY.body,
      };
    }
    if (round?.state === 'declined') return { ...DECLINED_COPY };
    return null;
  });

  /** The review card is offered only for a real order the kitchen HAS: never
   *  while the round is held or declined. Released is exactly today's gate. */
  readonly reviewOffered = computed<boolean>(
    () => !!this.orderId() && this.roundState() === 'released');

  /** The checkout's idempotency key — the ORDER'S OWN KEY, which the diner's
   *  order read (`orders/journey/order-details/?intent=`) resolves within the
   *  table session. Forwarded by checkout because it forgets the key from
   *  storage straight after navigating here. Only used to re-read a held round. */
  private readonly intentKey: string | null;

  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollSub: Subscription | null = null;
  private polling = false;
  private pollDelay = OrderCompleteComponent.POLL_MS;
  private readonly onVisibility = () => this.visibilityChanged();

  /** Table number forwarded from checkout via router navigation state. Null when
   *  the diner has no table context, in which case the Table cell is omitted. */
  readonly tableNumber = signal<number | null>(null);

  /** Human-facing order number forwarded from checkout (R1). Same value the KDS
   *  renders; null when a path doesn't carry it, in which case the Order cell is
   *  omitted. */
  readonly orderNumber = signal<number | null>(null);

  /** Real backend order id forwarded from checkout. Gates the whole review
   *  block: when null (e.g. the placeholder/no-id path) the success screen is
   *  unchanged and no review UI renders. */
  readonly orderId = signal<string | null>(null);

  /** Table id forwarded from checkout, used to route back to the diner's menu. */
  private readonly tableId: string | null;

  /** Restaurant social links forwarded from checkout via navigation state, then
   *  normalised into ready-to-render {key,label,href} entries. Empty when the
   *  restaurant has no socials (or none were forwarded) — the row stays hidden. */
  readonly socialLinks = signal<{ key: string; label: string; href: string }[]>([]);

  /** `#NNN`, formatted identically to the kitchen (3-digit pad) so the diner's
   *  number always matches the KDS. Null when no order number was forwarded. */
  readonly orderNumberLabel = computed<string | null>(() => {
    const n = this.orderNumber();
    return n != null ? formatOrderNumber(n) : null;
  });

  // ── Review capture state ───────────────────────────────────────────────────
  /** Per-dimension rows (handoff §3.6). Keys are the exact backend field names so
   *  a rated dimension drops straight into the submit payload; the template
   *  renders an inline SVG per key (see the socials-block @switch pattern). */
  readonly dimensions: { key: string; label: string }[] = [
    { key: 'food_rating', label: 'Food' },
    { key: 'speed_rating', label: 'Speed' },
    { key: 'service_rating', label: 'Service' },
    { key: 'value_rating', label: 'Value' },
    { key: 'cleanliness_rating', label: 'Cleanliness' },
  ];

  /** Quick chips (handoff §3.7). `label` is shown; only the stable `key` is ever
   *  sent to the backend — labels live solely on the frontend. Sourced from the
   *  shared single-source-of-truth map so the operator Reviews feed relabels in
   *  lockstep with this screen. */
  readonly tagChips: ReadonlyArray<ReviewTagChip> = REVIEW_TAG_CHIPS;

  /** Max comment length (handoff §3.7). */
  readonly commentMax = 240;

  /** Required overall rating (1-5); 0 means not yet rated. */
  readonly overall = signal<number>(0);
  /** Optional dimension ratings, keyed by backend field name. Seeded to 0 (unrated)
   *  for every dimension so a lookup is always a number; 0s are dropped at submit. */
  readonly dimensionRatings = signal<Record<string, number>>({
    food_rating: 0,
    speed_rating: 0,
    service_rating: 0,
    value_rating: 0,
    cleanliness_rating: 0,
  });
  /** Selected quick-chip stable keys. */
  readonly selectedTags = signal<string[]>([]);
  /** Optional free-text comment. */
  readonly comment = signal<string>('');
  /** True while the submit round-trip is in flight — disables the button. */
  readonly submitting = signal<boolean>(false);
  /** True once the review is accepted — swaps the form for a thank-you. */
  readonly submitted = signal<boolean>(false);

  /** Friendly verdict (text + emoji + colour) for the current overall rating. */
  readonly verdict = computed<Verdict>(() => VERDICTS[this.overall()] ?? VERDICTS[0]);

  constructor(private router: Router, private api: ApiService) {
    // Checkout forwards the table via navigation state right before it clears
    // sessionStorage, so read it from the current navigation (or history.state).
    const state =
      (this.router.getCurrentNavigation()?.extras?.state as Record<string, unknown> | undefined) ??
      (history.state as Record<string, unknown> | null) ??
      {};

    const n = state['tableNumber'];
    this.tableNumber.set(typeof n === 'number' && Number.isFinite(n) ? n : null);

    const num = state['orderNumber'];
    this.orderNumber.set(typeof num === 'number' && Number.isFinite(num) ? num : null);

    const id = state['tableId'];
    this.tableId = typeof id === 'string' && id.length > 0 ? id : null;

    const oid = state['orderId'];
    this.orderId.set(typeof oid === 'string' && oid.trim().length > 0 ? oid : null);

    this.socialLinks.set(this.buildSocialLinks(state['socials']));

    // Step 2: the submit reply's `current.round`, in its WIRE form, read by the
    // same reader the checkout reply and the order read use. A missing or
    // malformed value is null, which is released.
    this.round.set(readDinerRound(state['round']));
    const key = state['intentKey'];
    this.intentKey = typeof key === 'string' && key.trim().length > 0 ? key : null;

    // The route's title is "Order placed". Leave it alone for a released round
    // (today's behaviour) and say what is true while the kitchen does not have
    // the order; restore it if a held round is later released.
    let retitled = false;
    effect(() => {
      const copy = this.roundCopy();
      if (copy) {
        this.title.setTitle(copy.heading);
        retitled = true;
      } else if (retitled) {
        this.title.setTitle('Order placed');
      }
    });
  }

  ngOnInit(): void {
    // Always open the confirmation screen at the top — the router doesn't reset
    // scroll on navigation, so without this it inherits the basket's scroll
    // position. Mirrors BasketComponent / MenuItemDetailComponent.
    window.scrollTo({ top: 0, left: 0 });
    if (this.roundState() === 'held' && this.intentKey) this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // ── Step 2: re-reading a held round ────────────────────────────────────────
  // Every 10 s while held; stops for good on released or declined; paused
  // while the tab is hidden (an immediate read when it is shown again); a
  // failed or unusable read doubles the delay up to MAX_BACKOFF_MS and a good
  // one resets it. One read at a time, each bounded. Nothing here changes the
  // order: it is the diner's own GET, and withdrawal is not offered in Step 2.

  private startPolling(): void {
    this.polling = true;
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule(OrderCompleteComponent.POLL_MS);
  }

  private stopPolling(): void {
    this.polling = false;
    this.clearTimer();
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private clearTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private schedule(delay: number): void {
    this.clearTimer();
    if (!this.polling || this.document.hidden) return;   // paused while hidden
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.readRound();
    }, delay);
  }

  private visibilityChanged(): void {
    if (!this.polling) return;
    if (this.document.hidden) {
      this.clearTimer();
    } else if (!this.pollSub && this.pollTimer === null) {
      this.readRound();
    }
  }

  private readRound(): void {
    if (!this.polling || this.pollSub || this.document.hidden || !this.intentKey) {
      return;
    }
    // SILENT: nobody asked for this read, so no failure of it may toast. The
    // interceptor's `intent=` carve-out already keeps most failures quiet, but
    // its 429 branch runs first and would warn the diner on every retry of an
    // unattended screen (Codex P2 on #801). The backoff below handles it.
    this.pollSub = (this.api.get<unknown>(
      null, 'orders/journey/order-details/', { intent: this.intentKey },
      undefined, new HttpContext().set(SILENT_FAILURE, true),
    )).pipe(timeout(OrderCompleteComponent.READ_TIMEOUT_MS)).subscribe({
      next: (response) => {
        this.pollSub = null;
        this.applyRead(response);
      },
      error: () => {
        this.pollSub = null;
        this.backOff();
      },
    });
  }

  /**
   * Apply one order read. It counts only when it carries a readable correlated
   * projection naming THIS key (and this order, when one was forwarded); any
   * other answer says nothing about this round and is a failure. A readable
   * projection with no `round` is released, per the contract.
   */
  private applyRead(response: unknown): void {
    if (!this.polling) return;
    const correlation =
      readCorrelation((response as { data?: unknown } | null)?.data);
    const orderId = this.orderId();
    if (!correlation || correlation.intentKey !== this.intentKey
        || (orderId !== null && correlation.orderId !== orderId)) {
      this.backOff();
      return;
    }
    this.round.set(correlation.current.round);
    if (this.roundState() === 'held') {
      this.pollDelay = OrderCompleteComponent.POLL_MS;
      this.schedule(this.pollDelay);
    } else {
      this.stopPolling();
    }
  }

  private backOff(): void {
    if (!this.polling) return;
    this.pollDelay = Math.min(
      this.pollDelay * 2, OrderCompleteComponent.MAX_BACKOFF_MS);
    this.schedule(this.pollDelay);
  }

  /** Normalise the forwarded `socials` object into ordered, ready-to-render
   *  links. Each stored handle is a username OR a full URL; bare usernames are
   *  prefixed with the network base. Empty/unset handles are skipped, so a
   *  restaurant with no socials yields [] and the row never renders. */
  private buildSocialLinks(raw: unknown): { key: string; label: string; href: string }[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const socials = raw as Socials;
    const links: { key: string; label: string; href: string }[] = [];
    for (const net of SOCIAL_NETWORKS) {
      const value = socials[net.key];
      if (typeof value !== 'string') continue;
      const handle = value.trim();
      if (!handle) continue;
      const href = /^https?:\/\//i.test(handle)
        ? handle
        : net.base + handle.replace(/^@/, '');
      links.push({ key: net.key, label: net.label, href });
    }
    return links;
  }

  /** Returns the diner to the menu. With a forwarded table id we route through
   *  the scan path (re-initialises restaurant/table state); otherwise fall back
   *  to the generic menu route. */
  backToMenu(): void {
    if (this.tableId) {
      this.router.navigate(['/diner', 'h', this.tableId]);
    } else {
      this.router.navigate(['/diner', 'menu']);
    }
  }

  /** Record an optional dimension rating (StarRating emits 0 to clear). */
  setDimension(key: string, value: number): void {
    this.dimensionRatings.update((m) => ({ ...m, [key]: value }));
  }

  /** Toggle a quick-chip by its stable key. */
  toggleTag(key: string): void {
    this.selectedTags.update((tags) =>
      tags.includes(key) ? tags.filter((k) => k !== key) : [...tags, key],
    );
  }

  isTagSelected(key: string): boolean {
    return this.selectedTags().includes(key);
  }

  /** Mirror the comment textarea into the signal. */
  onComment(e: Event): void {
    this.comment.set((e.target as HTMLTextAreaElement).value);
  }

  /** Submit the review. Overall is required; every dimension, the comment and the
   *  tags are optional and omitted entirely when unset. On success we show a
   *  thank-you; on any error we simply re-enable the button — the global toast
   *  (raised by the HTTP error interceptor) already surfaces the backend message
   *  via ToastService, so the diner keeps their input and can retry. */
  submitReview(): void {
    const orderId = this.orderId();
    if (!orderId || !this.reviewOffered() || this.overall() < 1 || this.submitting()) return;
    this.submitting.set(true);

    const ratings = this.dimensionRatings();
    const comment = this.comment().trim();
    const tags = this.selectedTags();
    const payload: Record<string, unknown> = {
      order: orderId,
      overall_rating: this.overall(),
    };
    for (const dim of this.dimensions) {
      const v = ratings[dim.key];
      if (v >= 1 && v <= 5) {
        payload[dim.key] = v; // omit unrated dimensions entirely
      }
    }
    if (comment) {
      payload['comment'] = comment; // omit an empty comment
    }
    if (tags.length) {
      payload['tags'] = tags; // stable keys only; omit when none selected
    }

    this.api.postPatch('reviews/submit/', payload, 'post').subscribe(
      () => {
        this.submitting.set(false);
        this.submitted.set(true);
      },
      () => {
        // Errors surface via the global toast; just re-enable the button.
        this.submitting.set(false);
      },
    );
  }
}
