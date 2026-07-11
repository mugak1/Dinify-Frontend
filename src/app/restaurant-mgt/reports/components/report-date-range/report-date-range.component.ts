// Shared preset date-range control. Owns no committed state — it reads `value`
// and emits `valueChange`, so the shell binds it straight to
// ReportsService.dateRange$. The trigger opens a STAGED picker: an anchored CDK
// Overlay popover on desktop, a bottom sheet on mobile. Selection only commits on
// Apply; Cancel / Esc / backdrop discard. Emits zero-padded ISO ranges.
//
// CDK Overlay (not an in-flow absolute panel) is required: the host sits inside
// `overflow-hidden` ancestors that would clip an in-flow popover. The overlay
// renders at document.body, escaping the clip.

import { BreakpointObserver } from '@angular/cdk/layout';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { CommonModule } from '@angular/common';
import {
  Component,
  ComponentRef,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { format } from 'date-fns';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SheetComponent } from '../../../../_shared/ui/sheet/sheet.component';
import { ReportDateRange, presetToRange } from '../../models/reports.models';
import { DateRangePanelComponent } from './date-range-panel.component';
import { PRESET_LABELS, formatRangeSpan } from './range-label';

@Component({
  selector: 'app-report-date-range',
  standalone: true,
  imports: [CommonModule, SheetComponent, DateRangePanelComponent],
  template: `
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
export class ReportDateRangeComponent implements OnInit, OnDestroy {
  @Input() value: ReportDateRange = presetToRange('this-month');
  @Output() valueChange = new EventEmitter<ReportDateRange>();

  @ViewChild('trigger') triggerEl!: ElementRef<HTMLElement>;

  isOpen = false;
  isDesktop = false;

  private overlayRef?: OverlayRef;
  private panelRef?: ComponentRef<DateRangePanelComponent>;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private overlay: Overlay,
    private vcr: ViewContainerRef,
    private breakpoints: BreakpointObserver,
  ) {}

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
    this.valueChange.emit(range); // the only path that commits
    this.close();
  }

  onCancel(): void {
    this.closeDiscard();
  }

  ngOnDestroy(): void {
    this.close();
    this.destroy$.next();
    this.destroy$.complete();
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
