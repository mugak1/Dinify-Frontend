// The trend card is where PAIRING becomes visible, and where it becomes READABLE.
//
// Two things only this spec can catch. First, that `prev-month-by-day` and
// `prev-month-by-date` differ in the chart and nowhere else — they resolve to one window,
// so if the ghost series did not move, the pair would be two labels for one behaviour.
// Second, that the tooltip names BOTH dates: under by-day a point's comparison value no
// longer comes from the same date number, so without it the user sees two lines and has no
// way to learn what the grey one is aligned to.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { addDays, format, parseISO } from 'date-fns';

import { RevenueTrendCardComponent } from './revenue-trend-card.component';
import { SalesPoint } from './sales-view';

/** A dense daily series over `count` days from `from`; revenue is the 1-based index. */
const series = (from: string, count: number): SalesPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const key = format(addDays(parseISO(from), i), 'yyyy-MM-dd');
    return { label: format(parseISO(key), 'd MMM'), key, revenue: i + 1, orders: 1, discount: 0 };
  });

describe('RevenueTrendCardComponent', () => {
  let fixture: ComponentFixture<RevenueTrendCardComponent>;
  let component: RevenueTrendCardComponent;

  // July 2026 opens on a Wednesday, June 2026 on a Monday → a by-day offset of 2.
  const july = series('2026-07-01', 31);
  const june = series('2026-06-01', 30);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RevenueTrendCardComponent],
      providers: [provideCharts(withDefaultRegisterables())],
    }).compileComponents();

    fixture = TestBed.createComponent(RevenueTrendCardComponent);
    component = fixture.componentInstance;
  });

  function render(basis: 'prev-month-by-day' | 'prev-month-by-date'): void {
    fixture.componentRef.setInput('points', july);
    fixture.componentRef.setInput('comparisonPoints', june);
    fixture.componentRef.setInput('comparisonLabel', 'vs previous month');
    fixture.componentRef.setInput('bucketUnit', 'day');
    fixture.componentRef.setInput('basis', basis);
    fixture.detectChanges();
  }

  /** The dashed comparison line is dataset 0; the primary "Revenue" line is dataset 1. */
  const ghost = (): unknown[] => component.data.datasets[0].data as unknown[];

  describe('pairing changes the chart and nothing else', () => {
    it('draws a DIFFERENT ghost series under by-day than under by-date', () => {
      render('prev-month-by-date');
      const byDate = [...ghost()];

      render('prev-month-by-day');
      const byDay = [...ghost()];

      expect(byDay).not.toEqual(byDate);
      // by-date is index pairing: position N reads position N.
      expect(byDate[4]).toBe(june[4].revenue);
      // by-day shifts by 2, so Sun 5 Jul reads Sun 7 Jun.
      expect(byDay[4]).toBe(june[6].revenue);
    });

    it('keeps the x-axis on the PRIMARY range under either pairing', () => {
      render('prev-month-by-date');
      const byDate = [...(component.data.labels as unknown[])];
      render('prev-month-by-day');

      expect(component.data.labels).toEqual(byDate);
      expect(component.data.labels).toEqual(july.map((p) => p.label));
    });

    // Never wrapped, never clamped — Chart.js draws a gap, which is honest where a
    // fabricated point is not.
    it('emits null past the end of the comparison series rather than inventing a point', () => {
      render('prev-month-by-day');

      expect(ghost().length).toBe(july.length);
      expect(ghost().slice(-3)).toEqual([null, null, null]);
    });

    it('draws nothing at all when comparison is off', () => {
      render('prev-month-by-day');
      fixture.componentRef.setInput('compareEnabled', false);
      fixture.detectChanges();

      expect(ghost()).toEqual([]);
    });
  });

  describe('the tooltip names both dates', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callbacks = (): any => (component.options as any).plugins.tooltip.callbacks;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (datasetIndex: number, dataIndex: number, raw: unknown): any => ({
      datasetIndex,
      dataIndex,
      raw,
      dataset: { label: datasetIndex === 0 ? 'vs previous month' : 'Revenue' },
    });

    it('titles with the primary date, carrying the YEAR the axis label omits', () => {
      render('prev-month-by-day');

      // The axis label for this point is '5 Jul' — no year, so beside a comparison from a
      // different year it would be unreadable.
      expect(july[4].label).toBe('5 Jul');
      expect(callbacks().title([item(1, 4, 0)])).toBe('5 Jul 2026');
    });

    it('names the COMPARISON point date on the ghost row, under by-day', () => {
      render('prev-month-by-day');

      const line = callbacks().label(item(0, 4, june[6].revenue));
      expect(line).toContain('vs previous month');
      expect(line).toContain('7 Jun 2026'); // the Sunday it actually paired with
    });

    it('names the comparison date under by-date too, where it differs', () => {
      render('prev-month-by-date');

      const line = callbacks().label(item(0, 4, june[4].revenue));
      expect(line).toContain('5 Jun 2026');
    });

    it('leaves the primary row a plain label + value', () => {
      render('prev-month-by-day');

      const line = callbacks().label(item(1, 4, 5000));
      expect(line).toContain('Revenue');
      expect(line).not.toContain('Jun');
    });

    it('renders no ghost row where the pairing found nothing', () => {
      render('prev-month-by-day');

      // Index 30 is past the end of the shifted comparison series.
      expect(callbacks().label(item(0, 30, null))).toBe('');
    });
  });
});
