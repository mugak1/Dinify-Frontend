// Shared preset date-range control. Owns no committed state — it reads `value` and
// emits `valueChange`, so a host binds it straight to `TimeframeService.range$` /
// `set()`. That statelessness is what lets ONE instance serve both hosts (the Reports
// shell and the Dashboard header) with no per-host variant. The trigger opens a STAGED
// picker: an anchored CDK Overlay popover on desktop, a bottom sheet on mobile.
// Selection only commits on Apply; Cancel / Esc / backdrop discard. Emits zero-padded
// ISO ranges.
//
// TWO commit paths for the RANGE, both through `valueChange`: `onApply` (the staged
// picker) and `step` (the period arrows, 01C). The arrows deliberately add no second
// `@Output` — a step is just a new range, so both hosts inherited them with no host-side
// change at all.
//
// The comparison dropdown DOES carry its own `@Output`, and that is not a reversal of the
// note above: an arrow emits a new RANGE, so `valueChange` already expresses it, whereas a
// comparison basis is separate state and there is no range that means "compare against last
// year". Same reasoning, opposite conclusion, because it is a different kind of value.
//
// Both hosts render the full cluster as of 02B. The `showComparison` flag that kept the
// dropdown off the Dashboard through 02A is gone — it was scaffolding for that split, and a
// flag true at every call site is dead config.
//
// NAMING. Called `timeframe-picker`, not `report-date-range`: it was relocated here from
// the Reports module in TIMEFRAME-01B precisely because it stopped being Reports'. A
// selector naming one of its two hosts sends the next reader to the wrong module.
//
// IMPORTS. Siblings by direct path (`../timeframe-range`), never the barrel — the barrel
// re-exports this file, so importing it from here is a cycle. It would not fail the
// build; it would surface as an `undefined` at module-init. This file must also never
// import `../timeframe.service`: the picker is `value`/`valueChange` only, which keeps
// index → picker → timeframe-range a strict DAG.
//
// CDK Overlay (not an in-flow absolute panel) is required: the host sits inside
// `overflow-hidden` ancestors that would clip an in-flow popover. The overlay
// renders at document.body, escaping the clip.

import { NgClass } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ConnectedPosition, Overlay, OverlayModule, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';

import {
  Component,
  ComponentRef,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  ViewChild,
  ViewChildren,
  ViewContainerRef,
} from '@angular/core';
import { format } from 'date-fns';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SheetComponent } from '../../ui/sheet/sheet.component';
import { ComparisonOption, comparisonOptionLabel } from '../comparison-option';
import {
  classifyRangeShape,
  comparisonOptionsFor,
  resolveComparison,
  stepRange,
} from '../timeframe-engine';
import { ReportDateRange, presetToRange } from '../timeframe-range';
import { DateRangePanelComponent } from './date-range-panel.component';
import { ComparisonStartPanelComponent } from './comparison-start-panel.component';
import { PRESET_LABELS, formatRangeSpan } from './range-label';

@Component({
  selector: 'app-timeframe-picker',
  standalone: true,
  imports: [NgClass, OverlayModule, SheetComponent, DateRangePanelComponent],
  template: `
    <!-- Control cluster: [◀] [▶] [date button ▾]. The arrows are explicitly sized to the
         trigger's computed 38px (text-sm line-height 20 + py-2 + border), because the
         14px root makes rem-derived heights land ~12.5% short and this cluster sits in a
         header that feeds sticky offsets. -->
    <!-- flex-wrap, NOT truncation: at 360px with a custom period selected the comparison
         label is the only thing telling the operator what the figures are measured
         against, so it wraps to a second line instead of being cut. -->
    <div class="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        class="h-[38px] w-[38px] inline-flex items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Previous period"
        (click)="step(-1)"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      <button
        type="button"
        class="h-[38px] w-[38px] inline-flex items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:pointer-events-none"
        aria-label="Next period"
        [disabled]="nextDisabled"
        (click)="step(1)"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      <button
        #trigger
        type="button"
        class="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        [attr.aria-label]="'Date range: ' + triggerLabel + '. Activate to change.'"
        aria-haspopup="dialog"
        [attr.aria-expanded]="isOpen"
        (click)="open()"
      >
        <svg aria-hidden="true" class="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4" />
          <path d="M8 2v4" />
          <path d="M3 10h18" />
        </svg>
        <span>{{ presetLabel }} <span class="text-muted-foreground">·</span> {{ spanLabel }}</span>
      </button>

      <!-- Comparison basis (02A). Same h-[38px] as the rest of the cluster. Its menu is
           derived from the range's SHAPE, so it re-shapes as the range does. -->
      <button
        #cmpTrigger
        type="button"
        cdkOverlayOrigin
        #cmpOrigin="cdkOverlayOrigin"
        class="h-[38px] inline-flex items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        [attr.aria-label]="'Compare against: ' + comparisonTriggerLabel + '. Activate to change.'"
        aria-haspopup="listbox"
        [attr.aria-expanded]="cmpOpen"
        (click)="toggleComparison()"
        (keydown)="onTriggerKeydown($event)"
      >
        <svg aria-hidden="true" class="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18" />
          <path d="M7 12h10" />
          <path d="M11 18h2" />
        </svg>
        <span>{{ comparisonTriggerLabel }}</span>
        <svg aria-hidden="true" class="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="cmpOrigin"
        [cdkConnectedOverlayOpen]="cmpOpen"
        [cdkConnectedOverlayPositions]="cmpPositions"
        [cdkConnectedOverlayHasBackdrop]="true"
        cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
        cdkConnectedOverlayPanelClass="dn-comparison-overlay-panel"
        (backdropClick)="closeComparison()"
        (detach)="closeComparison()"
        (overlayKeydown)="onMenuKeydown($event)"
      >
        <div
          role="listbox"
          aria-label="Comparison basis"
          class="min-w-[13rem] overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
        >
          @for (option of comparisonOptions; track option; let i = $index) {
            <button
              #cmpOption
              type="button"
              role="option"
              [attr.aria-selected]="option === comparison"
              [attr.tabindex]="option === comparison ? 0 : -1"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              [ngClass]="option === comparison ? 'font-medium text-foreground' : 'text-muted-foreground'"
              (click)="pickComparison(option)"
            >
              <svg
                aria-hidden="true"
                class="h-4 w-4 shrink-0"
                [class.invisible]="option !== comparison"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{{ labelFor(option) }}</span>
            </button>
          }
        </div>
      </ng-template>
    </div>

    <!-- Mobile: bottom sheet. Only mounted below the desktop breakpoint. The
         desktop popover is the same DateRangePanelComponent, created imperatively
         into a CDK Overlay as a ComponentPortal (see openOverlay). -->
    @if (!isDesktop) {
      <app-dn-sheet side="bottom" [open]="isOpen" (closed)="onCancel()" ariaLabel="Select date range">
        <app-date-range-panel
          variant="sheet"
          [initial]="value"
          [today]="todayIso"
          (applied)="onApply($event)"
          (cancelled)="onCancel()"
        ></app-date-range-panel>
      </app-dn-sheet>
    }
  `,
})
export class TimeframePickerComponent implements OnInit, OnDestroy {
  @Input() value: ReportDateRange = presetToRange('this-month');
  @Output() valueChange = new EventEmitter<ReportDateRange>();

  /** The active comparison basis. `TimeframeService` owns it; this control never does. */
  @Input() comparison: ComparisonOption = 'none';

  /** The custom window's START (02D), or `null` when none is placed. Owned by the service. */
  @Input() customComparisonFrom: string | null = null;

  /**
   * One output for one concern — the basis, and for `'custom'` the start that goes with it.
   *
   * A second output for the start would mean the host makes two service calls, and between
   * them the basis reads `'custom'` with a stale or absent window: every consumer pipeline
   * would fire a request against the wrong dates before the right ones arrived. Carrying
   * both in one payload makes that unrepresentable rather than a rule each host must
   * remember.
   */
  @Output() comparisonChange = new EventEmitter<{
    option: ComparisonOption;
    customFrom?: string | null;
  }>();

  @ViewChild('trigger') triggerEl!: ElementRef<HTMLElement>;
  @ViewChild('cmpTrigger') cmpTriggerEl?: ElementRef<HTMLElement>;
  @ViewChildren('cmpOption') cmpOptionEls?: QueryList<ElementRef<HTMLElement>>;

  isOpen = false;
  isDesktop = false;
  cmpOpen = false;

  /** Below the trigger, flipping above when there is no room. Mirrors the range panel. */
  readonly cmpPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
  ];

  private overlayRef?: OverlayRef;
  private panelRef?: ComponentRef<DateRangePanelComponent>;
  /** The custom-start overlay (02D). Separate from the range popover above — both can
   *  never be open at once, but they attach different panels to different origins. */
  private customStartRef?: OverlayRef;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private overlay: Overlay,
    private vcr: ViewContainerRef,
    private breakpoints: BreakpointObserver,
  ) {}

  /**
   * The bases on offer for the current range's shape.
   *
   * The current selection is UNIONED IN even when the shape does not offer it. Shape is
   * derived from `new Date()` here and from the service's own `new Date()` there, so
   * across midnight the two can disagree for a single render — and a menu with nothing
   * selected reads as a bug. This is a defensive union, not a synchronisation mechanism;
   * `TimeframeService.carryComparison` is what actually keeps the selection legal.
   */
  get comparisonOptions(): ComparisonOption[] {
    const offered = comparisonOptionsFor(classifyRangeShape(this.value));
    return offered.includes(this.comparison) ? offered : [...offered, this.comparison];
  }

  get comparisonLabel(): string {
    return comparisonOptionLabel(this.comparison);
  }

  /**
   * What the TRIGGER shows: the basis name, plus the resolved dates FOR `'custom'` ONLY.
   *
   * THE ASYMMETRY IS DELIBERATE — do not "consistency-fix" it into either uniform dates or
   * a bare label. Every other basis's name fully determines its window given the range
   * ("Previous month" can only mean one thing), so dates there are redundant chrome. A
   * custom period is the one basis whose name says nothing about which window it names, and
   * the one whose window silently re-derives when an arrow step changes the range's length
   * — so showing it is also how the user sees that the step did the right thing.
   *
   * An unplaced custom period shows the bare label: there is no window to name yet.
   */
  get comparisonTriggerLabel(): string {
    if (this.comparison !== 'custom') return this.comparisonLabel;
    const w = resolveComparison(this.value, 'custom', undefined, this.customComparisonFrom);
    return w ? `${this.comparisonLabel} · ${formatRangeSpan(w.from, w.to)}` : this.comparisonLabel;
  }

  labelFor(option: ComparisonOption): string {
    return comparisonOptionLabel(option);
  }

  toggleComparison(): void {
    this.cmpOpen = !this.cmpOpen;
    if (this.cmpOpen) this.focusSelectedOption();
  }

  closeComparison(): void {
    if (!this.cmpOpen) return;
    this.cmpOpen = false;
    // Return focus to the trigger. The range popover does not do this (a pre-existing
    // gap); a menu is worse for it, since dismissing one drops you at <body> mid-header.
    this.cmpTriggerEl?.nativeElement.focus();
  }

  pickComparison(option: ComparisonOption): void {
    this.cmpOpen = false;
    this.cmpTriggerEl?.nativeElement.focus();

    // 'custom' is the ONE entry that does not commit on pick — it needs a start date, so it
    // opens a staged calendar and commits on Apply. Re-picking it while it is already the
    // basis re-opens that calendar, which is how the start is edited.
    if (option === 'custom') {
      this.openCustomStart();
      return;
    }

    if (option !== this.comparison) this.comparisonChange.emit({ option });
  }

  /** Apply from the custom-start panel: the basis and its start, committed together. */
  onCustomStartApplied(from: string): void {
    this.closeCustomStart();
    this.comparisonChange.emit({ option: 'custom', customFrom: from });
  }

  /** Cancel / Escape / backdrop — the previous basis is left entirely untouched. */
  onCustomStartCancelled(): void {
    this.closeCustomStart();
  }

  /** ArrowDown / ArrowUp / Enter / Space open the menu from the trigger. */
  onTriggerKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!this.cmpOpen) this.toggleComparison();
  }

  /** Roving focus inside the menu, plus Escape to dismiss. */
  onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeComparison();
      return;
    }

    const items = this.cmpOptionEls?.toArray() ?? [];
    if (!items.length) return;

    const current = items.findIndex((el) => el.nativeElement === document.activeElement);
    let next: number | null = null;

    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;

    if (next === null) return;
    event.preventDefault();
    items[next].nativeElement.focus();
  }

  /** Focus the selected row once the overlay has actually rendered its content. */
  private focusSelectedOption(): void {
    setTimeout(() => {
      const items = this.cmpOptionEls?.toArray() ?? [];
      const index = Math.max(0, this.comparisonOptions.indexOf(this.comparison));
      items[index]?.nativeElement.focus();
    });
  }

  get presetLabel(): string {
    return PRESET_LABELS[this.value.preset];
  }

  get spanLabel(): string {
    return formatRangeSpan(this.value.from, this.value.to);
  }

  get triggerLabel(): string {
    return `${this.presetLabel} · ${this.spanLabel}`;
  }

  get todayIso(): string {
    return format(new Date(), 'yyyy-MM-dd');
  }

  /**
   * There is no period after the present to step into. ISO calendar dates compare
   * lexically, so a string compare is the whole test.
   */
  get nextDisabled(): boolean {
    return this.value.to >= this.todayIso;
  }

  /**
   * Step the window one period, where "one period" comes from the range's SHAPE — a day
   * steps a day, a Mon–Sun week a week, a calendar month a whole month respecting month
   * lengths. All of that lives in `stepRange`; this only routes the click.
   *
   * Emitted through the existing `valueChange` rather than a new output: a step IS just a
   * new value, and both hosts already route `valueChange` into `TimeframeService.set()` —
   * which writes the URL with `replaceUrl: true`, so arrow spam cannot bury the page the
   * user arrived from under a stack of history entries.
   */
  step(direction: -1 | 1): void {
    this.valueChange.emit(stepRange(this.value, direction));
  }

  ngOnInit(): void {
    this.breakpoints
      .observe('(min-width: 1024px)')
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (state.matches === this.isDesktop) return;
        this.isDesktop = state.matches;
        // A surface for the other breakpoint is now wrong — discard cleanly.
        if (this.isOpen) this.closeDiscard();
      });
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    if (this.isDesktop) this.openOverlay();
    // Mobile: the @if + [open] binding renders the sheet.
  }

  onApply(range: ReportDateRange): void {
    this.valueChange.emit(range); // the only path the STAGED picker commits through
    this.close();
  }

  onCancel(): void {
    this.closeDiscard();
  }

  ngOnDestroy(): void {
    this.close();
    this.closeCustomStart();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * The staged custom-start calendar. Same imperative Overlay + ComponentPortal idiom as the
   * range panel above, and a separate overlay from the comparison dropdown, which has
   * already closed by the time this opens.
   */
  private openCustomStart(): void {
    this.closeCustomStart();
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.cmpTriggerEl!)
      .withFlexibleDimensions(false)
      .withPush(true)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
      ]);

    this.customStartRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'dn-comparison-start-overlay-panel',
    });

    const ref = this.customStartRef.attach(
      new ComponentPortal(ComparisonStartPanelComponent, this.vcr),
    );
    ref.setInput('variant', this.isDesktop ? 'popover' : 'sheet');
    ref.setInput('today', this.todayIso);
    ref.setInput('range', this.value);
    // Seed from the window the CURRENT basis resolves to, so the calendar opens somewhere
    // sensible rather than empty — a placed custom start if there is one, else the start of
    // whatever the active basis already compares against.
    ref.setInput('initial', this.customStartSeed());

    const closed$ = this.customStartRef.detachments();
    ref.instance.applied.pipe(takeUntil(closed$)).subscribe((f) => this.onCustomStartApplied(f));
    ref.instance.cancelled.pipe(takeUntil(closed$)).subscribe(() => this.onCustomStartCancelled());
    this.customStartRef
      .backdropClick()
      .pipe(takeUntil(closed$))
      .subscribe(() => this.closeCustomStart());
    this.customStartRef
      .keydownEvents()
      .pipe(takeUntil(closed$))
      .subscribe((e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeCustomStart();
        }
      });
  }

  private customStartSeed(): string | null {
    if (this.customComparisonFrom) return this.customComparisonFrom;
    const current = resolveComparison(this.value, this.comparison);
    return current?.from ?? null;
  }

  private closeCustomStart(): void {
    if (!this.customStartRef) return;
    this.customStartRef.detach();
    this.customStartRef.dispose();
    this.customStartRef = undefined;
    this.cmpTriggerEl?.nativeElement.focus();
  }

  private openOverlay(): void {
    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(this.triggerEl)
      .withFlexibleDimensions(false)
      .withPush(false)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
      ]);

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'dn-daterange-overlay-panel',
    });

    this.panelRef = this.overlayRef.attach(new ComponentPortal(DateRangePanelComponent, this.vcr));
    this.panelRef.setInput('variant', 'popover');
    this.panelRef.setInput('today', this.todayIso);
    this.panelRef.setInput('initial', this.value);

    // Tie every overlay-scoped subscription to this overlay's lifetime so they're
    // torn down on close (detach), not accumulated across repeated opens.
    const closed$ = this.overlayRef.detachments();
    this.panelRef.instance.applied
      .pipe(takeUntil(closed$))
      .subscribe((range) => this.onApply(range));
    this.panelRef.instance.cancelled
      .pipe(takeUntil(closed$))
      .subscribe(() => this.onCancel());

    this.overlayRef
      .backdropClick()
      .pipe(takeUntil(closed$))
      .subscribe(() => this.closeDiscard());

    this.overlayRef
      .keydownEvents()
      .pipe(takeUntil(closed$))
      .subscribe((e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeDiscard();
        }
      });
  }

  /** Close with no emit — used by Cancel, Esc, backdrop, and breakpoint flips. */
  private closeDiscard(): void {
    this.close();
  }

  private close(): void {
    this.isOpen = false;
    this.panelRef = undefined; // disposed with the overlay below
    if (this.overlayRef) {
      this.overlayRef.detach();
      this.overlayRef.dispose();
      this.overlayRef = undefined;
    }
  }
}
