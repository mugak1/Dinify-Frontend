import { BreakpointObserver, BreakpointState } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { ReportDateRangeComponent } from './report-date-range.component';
import { ReportDateRange } from '../../models/reports.models';

describe('ReportDateRangeComponent', () => {
  let fixture: ComponentFixture<ReportDateRangeComponent>;
  let component: ReportDateRangeComponent;
  let emitted: ReportDateRange[];
  let bp$: BehaviorSubject<BreakpointState>;

  function trigger(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('button[aria-haspopup="dialog"]');
  }

  function overlayButton(text: string): HTMLButtonElement | undefined {
    const overlay = document.querySelector('.dn-daterange-overlay-panel');
    if (!overlay) return undefined;
    return Array.from(overlay.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === text,
    ) as HTMLButtonElement | undefined;
  }

  function overlayPanel(): Element | null {
    return document.querySelector('.dn-daterange-overlay-panel');
  }

  beforeEach(async () => {
    bp$ = new BehaviorSubject<BreakpointState>({ matches: true, breakpoints: {} });

    await TestBed.configureTestingModule({
      imports: [ReportDateRangeComponent],
      providers: [
        { provide: BreakpointObserver, useValue: { observe: () => bp$.asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportDateRangeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('value', {
      preset: 'this-month',
      from: '2026-06-01',
      to: '2026-06-30',
    } as ReportDateRange);
    emitted = [];
    component.valueChange.subscribe((r) => emitted.push(r));
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('renders the trigger showing the committed preset and span', () => {
    fixture.detectChanges();
    const text = (trigger().textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toContain('This month');
    expect(text).toContain('1–30 Jun 2026');
  });

  describe('desktop (popover)', () => {
    beforeEach(() => {
      bp$.next({ matches: true, breakpoints: {} });
      fixture.detectChanges();
    });

    it('opens an anchored CDK Overlay popover', () => {
      trigger().click();
      fixture.detectChanges();
      expect(overlayPanel()).toBeTruthy();
    });

    it('stages a preset without committing (no valueChange)', () => {
      trigger().click();
      fixture.detectChanges();
      overlayButton('Today')!.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeTruthy(); // still open
    });

    it('commits the staged range exactly once on Apply, then closes', () => {
      trigger().click();
      fixture.detectChanges();
      overlayButton('Today')!.click();
      fixture.detectChanges();
      overlayButton('Apply')!.click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].preset).toBe('today');
      expect(overlayPanel()).toBeNull();
    });

    it('discards on Cancel', () => {
      trigger().click();
      fixture.detectChanges();
      overlayButton('Cancel')!.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeNull();
    });

    it('discards on backdrop click', () => {
      trigger().click();
      fixture.detectChanges();
      const backdrop = document.querySelector('.cdk-overlay-backdrop') as HTMLElement;
      expect(backdrop).toBeTruthy();
      backdrop.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeNull();
    });

    it('discards on Escape', () => {
      trigger().click();
      fixture.detectChanges();
      overlayPanel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(emitted.length).toBe(0);
      expect(overlayPanel()).toBeNull();
    });
  });

  describe('mobile (bottom sheet)', () => {
    beforeEach(() => {
      bp$.next({ matches: false, breakpoints: {} });
      fixture.detectChanges();
    });

    it('opens a bottom sheet (not an overlay)', () => {
      trigger().click();
      fixture.detectChanges();
      expect(overlayPanel()).toBeNull();
      expect(fixture.nativeElement.querySelector('app-date-range-panel')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.fixed.bottom-0')).toBeTruthy();
    });

    it('commits once on Apply', () => {
      trigger().click();
      fixture.detectChanges();
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('app-date-range-panel button'),
      ) as HTMLButtonElement[];
      buttons.find((b) => (b.textContent ?? '').trim() === 'Today')!.click();
      fixture.detectChanges();
      buttons.find((b) => (b.textContent ?? '').trim() === 'Apply')!.click();
      fixture.detectChanges();
      expect(emitted.length).toBe(1);
      expect(emitted[0].preset).toBe('today');
    });
  });
});
