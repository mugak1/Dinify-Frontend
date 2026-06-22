// Presentational range calendar. Renders one or two Monday-start month grids and
// reports a {from,to} range as the user clicks. It is "controlled-reset,
// uncontrolled-interaction": the `seed` input resets its selection (on open and
// on preset clicks), while day clicks drive its own internal start/end and only
// EMIT — the parent must NOT feed a click result back into `seed`, or the
// in-progress selection would be wiped (see date-range-panel for the contract).

import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import {
  addMonths,
  endOfMonth,
  format,
  getDate,
  getMonth,
  getYear,
  isBefore,
  parseISO,
  startOfMonth,
  subMonths,
} from 'date-fns';

interface DayCell {
  date: Date;
  iso: string;
  label: number;
  disabled: boolean;
  isToday: boolean;
  isStart: boolean;
  isEnd: boolean;
  inRange: boolean;
  ariaLabel: string;
}

interface MonthView {
  key: string;
  label: string;
  blanks: number[];
  cells: DayCell[];
}

@Component({
  selector: 'app-range-calendar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex gap-4 justify-center">
      @for (m of months; track m.key; let i = $index) {
        <div class="w-64">
          <div class="flex items-center justify-between mb-2 h-8">
            @if (i === 0) {
              <button
                type="button"
                class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                aria-label="Previous month"
                (click)="prevMonth()"
              >
                <svg aria-hidden="true" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            } @else {
              <span class="h-8 w-8"></span>
            }

            <span class="text-sm font-medium">{{ m.label }}</span>

            @if (i === months.length - 1) {
              <button
                type="button"
                class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground"
                aria-label="Next month"
                [disabled]="nextDisabled"
                (click)="nextMonth()"
              >
                <svg aria-hidden="true" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            } @else {
              <span class="h-8 w-8"></span>
            }
          </div>

          <div class="grid grid-cols-7 gap-1">
            @for (w of weekdays; track w) {
              <div class="h-7 flex items-center justify-center text-xs text-muted-foreground">{{ w }}</div>
            }
            @for (b of m.blanks; track b) {
              <div aria-hidden="true"></div>
            }
            @for (cell of m.cells; track cell.iso) {
              <button
                type="button"
                class="h-9 w-full inline-flex items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                [attr.data-iso]="cell.iso"
                [disabled]="cell.disabled"
                [attr.aria-label]="cell.ariaLabel"
                [attr.aria-pressed]="cell.isStart || cell.isEnd"
                [ngClass]="{
                  'bg-primary text-primary-foreground': cell.isStart || cell.isEnd,
                  'bg-primary/15': cell.inRange,
                  'hover:bg-accent hover:text-accent-foreground': !cell.disabled && !cell.isStart && !cell.isEnd && !cell.inRange,
                  'text-muted-foreground/40 cursor-not-allowed': cell.disabled,
                  'font-semibold': cell.isToday && !cell.isStart && !cell.isEnd
                }"
                (click)="onDayClick(cell)"
              >
                {{ cell.label }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class RangeCalendarComponent implements OnChanges {
  @Input() seed!: { from: string; to: string };
  @Input() monthCount: 1 | 2 = 1;
  @Input() today = '';
  @Output() rangeChange = new EventEmitter<{ from: string; to: string }>();

  readonly weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  months: MonthView[] = [];
  nextDisabled = false;

  /** The calendar's own selection. Seeded from `seed`, then driven by clicks. */
  private start: Date | null = null;
  private end: Date | null = null;
  /** True once a start is set and we're waiting for the end click. */
  private pendingEnd = false;
  /** Left-most visible month. */
  private viewMonth = startOfMonth(new Date());

  ngOnChanges(changes: SimpleChanges): void {
    // A new `seed` reference (open / preset click) resets the selection and view.
    if (changes['seed']) this.applySeed();
    this.rebuild();
  }

  onDayClick(cell: DayCell): void {
    if (cell.disabled) return;
    const d = cell.date;

    if (!this.pendingEnd) {
      // First click: set the start, clear the end.
      this.start = d;
      this.end = d;
      this.pendingEnd = true;
    } else if (this.start && cell.iso < this.iso(this.start)) {
      // Click before the start: restart the selection.
      this.start = d;
      this.end = d;
      this.pendingEnd = true;
    } else {
      // Click on/after the start: complete the range.
      this.end = d;
      this.pendingEnd = false;
    }

    this.rebuild();
    this.rangeChange.emit({ from: this.iso(this.start as Date), to: this.iso(this.end as Date) });
  }

  prevMonth(): void {
    this.viewMonth = subMonths(this.viewMonth, 1);
    this.rebuild();
  }

  nextMonth(): void {
    if (this.nextDisabled) return;
    this.viewMonth = addMonths(this.viewMonth, 1);
    this.rebuild();
  }

  private applySeed(): void {
    const todayIso = this.today || this.iso(new Date());
    const from = this.seed?.from || todayIso;
    const to = this.seed?.to || todayIso;
    this.start = parseISO(from);
    this.end = parseISO(to);
    this.pendingEnd = false;
    // Frame the view on the end month so the most recent month sits on the right.
    const endMonth = startOfMonth(parseISO(to));
    this.viewMonth = this.monthCount === 2 ? subMonths(endMonth, 1) : endMonth;
  }

  private rebuild(): void {
    const months: MonthView[] = [];
    for (let i = 0; i < this.monthCount; i++) {
      months.push(this.buildMonth(addMonths(this.viewMonth, i)));
    }
    this.months = months;

    const todayIso = this.today || this.iso(new Date());
    const rightMonth = addMonths(this.viewMonth, this.monthCount - 1);
    // Disable "next" once the right-most visible month is the current one (or
    // later) — navigating further would only show all-future, disabled days.
    this.nextDisabled = !isBefore(startOfMonth(rightMonth), startOfMonth(parseISO(todayIso)));
  }

  private buildMonth(monthStart: Date): MonthView {
    const first = startOfMonth(monthStart);
    const daysInMonth = getDate(endOfMonth(first));
    const leading = (first.getDay() + 6) % 7; // Monday-start offset
    const todayIso = this.today || this.iso(new Date());
    const startIso = this.start ? this.iso(this.start) : null;
    const endIso = this.end ? this.iso(this.end) : null;

    const cells: DayCell[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(getYear(first), getMonth(first), day);
      const iso = this.iso(date);
      const isStart = startIso !== null && iso === startIso;
      const isEnd = endIso !== null && iso === endIso;
      cells.push({
        date,
        iso,
        label: day,
        disabled: iso > todayIso,
        isToday: iso === todayIso,
        isStart,
        isEnd,
        inRange: startIso !== null && endIso !== null && iso > startIso && iso < endIso,
        ariaLabel: format(date, 'EEEE, d MMMM yyyy'),
      });
    }

    return {
      key: this.iso(first),
      label: format(first, 'MMMM yyyy'),
      blanks: Array.from({ length: leading }, (_, i) => i),
      cells,
    };
  }

  private iso(d: Date): string {
    return format(d, 'yyyy-MM-dd');
  }
}
