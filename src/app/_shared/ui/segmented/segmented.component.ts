import {
  AfterViewInit,
  Component,
  ContentChild,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  Output,
  QueryList,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewChildren,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { cn } from '../../utils/cn';

/** One segment in the control. `value` is the selection key; `path` promotes the segment
 *  to a router link (router mode); `icon` is an opaque key the host's projected `#icon`
 *  template interprets; `hasError` renders a trailing `*` (value mode). */
export interface DnSegItem {
  value: string;
  label: string;
  icon?: string;
  path?: string | any[];
  disabled?: boolean;
  hasError?: boolean;
  /** Optional panel id, for callers that opt into full `aria-controls` wiring (value mode). */
  controls?: string;
}

export type DnSegMode = 'value' | 'router';
export type DnSegLayout = 'hug' | 'responsive' | 'fill';

/**
 * The single soft-segmented "pick-one-from-a-group" control (supersedes the old dn-tabs and
 * the bespoke Reports rail). A sunken pill track holds N segments and one absolutely-positioned
 * WHITE glider that slides to the active segment; the active segment's text/icon go
 * `text-foreground`, inactive `text-muted-foreground hover:text-foreground` (icons inherit via
 * `currentColor`). Pure semantic tokens — no hex colours.
 *
 * Two modes, chosen by `[mode]`:
 *  • `value` (default) — click-select `<button role="tab">`s; emits `(valueChange)`; sets the
 *    active segment OPTIMISTICALLY on click (so a consumer whose bound `[value]` only echoes back
 *    after an async round-trip still lights up immediately). Roving tabindex + Arrow/Home/End.
 *  • `router` — `<a routerLink>` navigation with `aria-current="page"`; the host owns the
 *    URL→`[value]` derivation and wraps the control in its own `<nav aria-label>` landmark.
 *
 * The glider is measured off each segment's `offsetLeft`/`offsetWidth` and re-synced via a
 * `ResizeObserver` on the track, a `QueryList.changes` subscription, and `document.fonts.ready`.
 * `syncGlider()` ignores a zero width (so an eagerly-instantiated-but-detached instance — e.g. the
 * item-form dialog before it opens — never stores bogus geometry), and the slide transition only
 * arms after the FIRST non-zero measurement, so the first real placement is an instant jump.
 */
@Component({
  selector: 'app-dn-segmented',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div
      #track
      [class]="trackClass()"
      [attr.role]="mode === 'value' ? 'tablist' : null"
      [attr.aria-label]="mode === 'value' ? ariaLabel : null"
    >
      <!-- Sliding active-segment card. Geometry/opacity/transition are bound; colour/shadow are
           static. aria-hidden: active state is exposed on the segment (aria-selected / aria-current). -->
      <span
        aria-hidden="true"
        [class]="gliderClass"
        [style.left.px]="gliderLeft()"
        [style.width.px]="gliderWidth()"
        [style.transition]="ready() ? transition : 'none'"
        [style.opacity]="ready() ? 1 : 0"
      ></span>

      @for (it of items; track it.value; let i = $index) {
        @if (mode === 'router') {
          <a
            #seg
            [routerLink]="it.path"
            [relativeTo]="relativeTo ?? null"
            [attr.aria-current]="isActive(it) ? 'page' : null"
            [class]="segClass(it)"
          >
            <ng-container
              *ngTemplateOutlet="iconTpl ?? null; context: { $implicit: it, active: isActive(it) }"
            ></ng-container>
            <span [class]="labelClass">{{ it.label }}</span>
          </a>
        } @else {
          <button
            #seg
            type="button"
            role="tab"
            [attr.aria-selected]="isActive(it)"
            [attr.aria-controls]="it.controls ?? null"
            [tabindex]="isActive(it) ? 0 : -1"
            [disabled]="!!it.disabled"
            (click)="select(it)"
            (keydown)="onKey($event, i)"
            [class]="segClass(it)"
          >
            <ng-container
              *ngTemplateOutlet="iconTpl ?? null; context: { $implicit: it, active: isActive(it) }"
            ></ng-container>
            <span [class]="labelClass">{{ it.label }}</span>
            @if (it.hasError) { <span class="ml-0.5">*</span> }
          </button>
        }
      }
    </div>
  `,
})
export class DnSegmentedComponent implements OnChanges, AfterViewInit {
  @Input() items: DnSegItem[] = [];
  @Input() value = '';
  @Input() mode: DnSegMode = 'value';
  @Input() layout: DnSegLayout = 'hug';
  @Input() ariaLabel?: string;
  /** Value mode: move focus with the arrows but only select on Enter/Space (for heavy panels
   *  where selection-follows-focus would thrash mounts, e.g. the item-form dialog). */
  @Input() manualActivation = false;
  /** Router mode escape hatch — pass the host's `ActivatedRoute` so relative `routerLink`s
   *  resolve unambiguously even under a nested outlet. Unbound is fine for the common case. */
  @Input() relativeTo?: ActivatedRoute;

  /** Value mode only. */
  @Output() valueChange = new EventEmitter<string>();

  /** Optional leading-icon template; context = `{ $implicit: item, active }`. */
  @ContentChild('icon', { read: TemplateRef }) iconTpl?: TemplateRef<unknown>;

  @ViewChild('track') private trackEl?: ElementRef<HTMLElement>;
  @ViewChildren('seg') private segs!: QueryList<ElementRef<HTMLElement>>;

  /** Active segment value — driven by `[value]` (external) AND set optimistically on click. */
  readonly active = signal('');
  readonly gliderLeft = signal(0);
  readonly gliderWidth = signal(0);
  /** Stays false (glider hidden, no transition) until the first non-zero measurement. */
  readonly ready = signal(false);

  readonly transition =
    'left 0.3s cubic-bezier(0.22, 1, 0.36, 1), width 0.3s cubic-bezier(0.22, 1, 0.36, 1)';

  readonly gliderClass =
    'pointer-events-none absolute top-[5px] bottom-[5px] z-0 rounded-[10px] bg-background shadow-[var(--shadow-sm)]';

  readonly labelClass = 'truncate min-w-0 transition-colors';

  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private resizeObserver?: ResizeObserver;

  ngOnChanges(changes: SimpleChanges): void {
    // Follow the controlled value (reports URL nav; item-form's programmatic switch — the exact
    // case old dn-tabs silently dropped). A re-measure keeps the glider under the new segment.
    if (changes['value']) {
      this.active.set(this.value);
    }
    if (changes['value'] || changes['items']) {
      this.measureSoon();
    }
  }

  ngAfterViewInit(): void {
    this.measureSoon();

    // Re-measure when the rendered segment set changes (items added/removed/reordered).
    this.segs.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.measureSoon());

    // The track's width changing is the real "became visible / laid out" signal — it fires when a
    // dialog's @if attaches this subtree (0→N), on sidebar collapse, and on window resize. RO
    // callbacks run outside Angular's zone, so re-enter it to flush the signal writes.
    if (this.trackEl && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.zone.run(() => this.syncGlider()));
      this.resizeObserver.observe(this.trackEl.nativeElement);
      this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    }

    // A late web-font swap reflows hug/w-fit segment widths without changing the track width, so
    // the track RO wouldn't fire — re-sync once fonts settle.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => this.zone.run(() => this.syncGlider()));
    }
  }

  isActive(it: DnSegItem): boolean {
    return this.active() === it.value;
  }

  /** Value mode: optimistic select + emit. No-op for disabled items. */
  select(it: DnSegItem): void {
    if (it.disabled) return;
    this.active.set(it.value);
    this.valueChange.emit(it.value);
    this.measureSoon();
  }

  /** Value-mode roving keyboard nav: arrows/Home/End move focus (and select, unless
   *  `manualActivation`); Enter/Space select. Disabled segments are skipped. */
  onKey(ev: KeyboardEvent, index: number): void {
    const { key } = ev;
    if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'Home' || key === 'End') {
      const next = this.nextEnabledIndex(index, key);
      if (next === -1) return;
      ev.preventDefault();
      this.segs.get(next)?.nativeElement.focus();
      if (!this.manualActivation) this.select(this.items[next]);
    } else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      ev.preventDefault();
      this.select(this.items[index]);
    }
  }

  trackClass(): string {
    const width =
      this.layout === 'responsive'
        ? 'flex w-full sm:w-fit'
        : this.layout === 'fill'
          ? 'flex w-full'
          : 'inline-flex';
    return cn('relative items-center rounded-[13px] p-[5px] bg-muted', width);
  }

  segClass(it: DnSegItem): string {
    const flex =
      this.layout === 'responsive'
        ? 'flex-1 sm:flex-none min-w-0'
        : this.layout === 'fill'
          ? 'flex-1 min-w-0'
          : 'flex-none';
    return cn(
      'relative z-10 flex items-center justify-center gap-2 h-[38px] px-3 sm:px-4 rounded-[10px]',
      'text-[13.5px] font-semibold no-underline select-none transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      flex,
      this.isActive(it) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      it.disabled && 'opacity-50 pointer-events-none',
      // Error ink wins over the active/inactive colour (value mode, e.g. the item-form tabs).
      it.hasError && 'text-destructive',
    );
  }

  /** Place the glider over the active segment. offsetLeft/offsetWidth are read against the
   *  `relative` track (the segments' offsetParent), so the track's 5px padding cancels out.
   *  A zero width means detached/not-yet-laid-out — keep the last good geometry rather than
   *  snapping the glider to 0. */
  private syncGlider(): void {
    const index = this.items.findIndex((i) => i.value === this.active());
    const el = this.segs?.get(index)?.nativeElement;
    if (!el) return;
    const width = el.offsetWidth;
    if (width === 0) return;
    this.gliderLeft.set(el.offsetLeft);
    this.gliderWidth.set(width);
    // Arm the slide only after this first real placement has been committed, so it lands
    // instantly instead of animating in from left:0/width:0.
    if (!this.ready()) requestAnimationFrame(() => this.ready.set(true));
  }

  /** Defer the read one frame so layout (and any pending style/attr change) has settled. */
  private measureSoon(): void {
    requestAnimationFrame(() => this.syncGlider());
  }

  private nextEnabledIndex(from: number, key: string): number {
    const n = this.items.length;
    if (n === 0) return -1;
    const enabled = (i: number) => !this.items[i]?.disabled;
    if (key === 'Home') {
      for (let i = 0; i < n; i++) if (enabled(i)) return i;
      return -1;
    }
    if (key === 'End') {
      for (let i = n - 1; i >= 0; i--) if (enabled(i)) return i;
      return -1;
    }
    const dir = key === 'ArrowRight' ? 1 : -1;
    for (let step = 1; step <= n; step++) {
      const i = ((from + dir * step) % n + n) % n;
      if (enabled(i)) return i;
    }
    return -1;
  }
}
