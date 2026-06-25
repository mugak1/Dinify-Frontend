import { Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DollarSign, type LucideIconData, Trash2, User, Utensils, Zap } from 'lucide-angular';
import { ApiService } from 'src/app/_services/api.service';
import { Socials } from 'src/app/_models/app.models';
import { formatOrderNumber } from 'src/app/kitchen/services/kitchen-logic';

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
    selector: 'app-order-complete',
    templateUrl: './order-complete.component.html',
    styleUrl: './order-complete.component.css',
    standalone: false
})
export class OrderCompleteComponent {
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
   *  a rated dimension drops straight into the submit payload; `icon` is the
   *  Lucide glyph bound via [img]. */
  readonly dimensions: { key: string; label: string; icon: LucideIconData }[] = [
    { key: 'food_rating', label: 'Food', icon: Utensils },
    { key: 'speed_rating', label: 'Speed', icon: Zap },
    { key: 'service_rating', label: 'Service', icon: User },
    { key: 'value_rating', label: 'Value', icon: DollarSign },
    { key: 'cleanliness_rating', label: 'Cleanliness', icon: Trash2 },
  ];

  /** Quick chips (handoff §3.7). `label` is shown; only the stable `key` is ever
   *  sent to the backend — labels live solely on the frontend. */
  readonly tagChips: { label: string; key: string }[] = [
    { label: 'Great flavour', key: 'great_flavour' },
    { label: 'Quick service', key: 'quick_service' },
    { label: 'Friendly staff', key: 'friendly_staff' },
    { label: 'Good value', key: 'good_value' },
    { label: 'Spotless', key: 'spotless' },
  ];

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
    if (!orderId || this.overall() < 1 || this.submitting()) return;
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
