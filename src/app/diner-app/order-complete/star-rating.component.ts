import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

/** Process-wide counter so every StarRating instance gets a unique gradient id.
 *  Six star groups render on the review screen (1 overall + 5 category); a shared
 *  SVG gradient id would make later groups reference the first group's <defs> and
 *  break their gold fills (handoff §3.1). */
let starInstanceCounter = 0;

/**
 * StarRating (handoff §3.1–3.2). A row of five gold stars.
 *
 * - Pointer hover previews the fill 1..n; the active fill is `hover || value`.
 * - Clicking the current value again clears it (toggle to 0).
 * - `value`/`valueChange` drive it from a parent signal: `[value]="overall()"
 *   (valueChange)="overall.set($event)"`.
 * - `interactive=false` renders a static, non-button recap (thank-you state).
 *
 * The star is the custom rounded path; filled = vertical gold gradient
 * (#FCC419→#F08C00, an intentional one-off, not a token) with a warm drop-shadow;
 * empty = hairline stroke at a hair-smaller scale so fills "pop".
 */
@Component({
  selector: 'app-star-rating',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Unique gradient def per instance; referenced by every filled star below. -->
    <svg aria-hidden="true" focusable="false" width="0" height="0" class="grad-host">
      <defs>
        <linearGradient [attr.id]="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#FCC419" />
          <stop offset="1" stop-color="#F08C00" />
        </linearGradient>
      </defs>
    </svg>

    <div class="row" [class.row--sm]="size() <= 20" (mouseleave)="onLeave()">
      @for (n of stars; track n) {
        @if (interactive()) {
          <button
            type="button"
            class="star-btn"
            (mouseenter)="onEnter(n)"
            (click)="pick(n)"
            [attr.aria-label]="label(n)"
            [attr.aria-pressed]="n <= value()"
          >
            <ng-container [ngTemplateOutlet]="star" [ngTemplateOutletContext]="{ $implicit: n }"></ng-container>
          </button>
        } @else {
          <ng-container [ngTemplateOutlet]="star" [ngTemplateOutletContext]="{ $implicit: n }"></ng-container>
        }
      }
    </div>

    <ng-template #star let-n>
      <svg
        [attr.width]="size()"
        [attr.height]="size()"
        viewBox="0 0 24 24"
        class="star"
        [class.is-filled]="n <= active()"
        aria-hidden="true"
      >
        <path
          d="M12 2.6c.27 0 .52.16.64.42l2.45 5.18 5.45.8c.6.09.84.84.4 1.27l-3.96 3.95.94 5.6c.1.6-.53 1.05-1.06.77L12 17.78l-4.86 2.6c-.53.28-1.16-.17-1.06-.77l.94-5.6-3.96-3.95c-.44-.43-.2-1.18.4-1.27l5.45-.8 2.45-5.18c.12-.26.37-.42.64-.42Z"
          [attr.fill]="n <= active() ? 'url(#' + gradId + ')' : 'none'"
          [attr.stroke]="n <= active() ? 'none' : '#D9D9D9'"
          [attr.stroke-width]="n <= active() ? 0 : 1.6"
          stroke-linejoin="round"
        />
      </svg>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }
      .grad-host {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
      }
      .row {
        display: flex;
        gap: 10px;
      }
      .row--sm {
        gap: 5px;
      }
      .star-btn {
        background: none;
        border: none;
        padding: 2px;
        margin: 0;
        cursor: pointer;
        line-height: 0;
        border-radius: 8px;
        -webkit-tap-highlight-color: transparent;
      }
      .star-btn:focus-visible {
        outline: 2px solid var(--d-red, #ff2c32);
        outline-offset: 2px;
      }
      .star {
        display: block;
        transform: scale(0.96);
        transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      .star.is-filled {
        transform: scale(1);
        filter: drop-shadow(0 3px 5px rgba(240, 140, 0, 0.38));
      }
      @media (prefers-reduced-motion: reduce) {
        .star {
          transition: none;
        }
      }
    `,
  ],
})
export class StarRatingComponent {
  /** Current rating 0–5 (driven by a parent signal). */
  readonly value = input(0);
  /** Star edge length in px: 40 overall, 20 category, 22 recap. */
  readonly size = input(40);
  /** Prefix for each button's aria-label, e.g. "Food" → "Food, 3 stars". */
  readonly ariaLabelPrefix = input('');
  /** False renders a static, non-interactive recap (no buttons, no hover). */
  readonly interactive = input(true);

  readonly valueChange = output<number>();

  readonly stars = [1, 2, 3, 4, 5];

  /** Unique SVG gradient id for this instance — referenced by all five filled
   *  stars. Per-instance so the six star groups on screen never share a <defs>
   *  (a shared id breaks the later groups' gold fills — handoff §3.1). */
  readonly gradId = `star-grad-${++starInstanceCounter}`;

  private readonly hover = signal(0);

  /** Fill extent: hover preview wins while pointing, else the committed value. */
  readonly active = computed(() => (this.interactive() ? this.hover() || this.value() : this.value()));

  onEnter(n: number): void {
    this.hover.set(n);
  }

  onLeave(): void {
    this.hover.set(0);
  }

  /** Click n: clear when it equals the current value, else set n (handoff §3.2). */
  pick(n: number): void {
    const next = n === this.value() ? 0 : n;
    this.hover.set(0); // clear sticky hover so the committed value shows (touch)
    this.valueChange.emit(next);
  }

  label(n: number): string {
    const prefix = this.ariaLabelPrefix() ? `${this.ariaLabelPrefix()}, ` : '';
    return `${prefix}${n} ${n === 1 ? 'star' : 'stars'}`;
  }
}
