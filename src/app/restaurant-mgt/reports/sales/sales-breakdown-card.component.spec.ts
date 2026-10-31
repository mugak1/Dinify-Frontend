import { TestBed } from '@angular/core/testing';
import { SalesBreakdownCardComponent } from './sales-breakdown-card.component';

describe('SalesBreakdownCardComponent — search placeholder', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SalesBreakdownCardComponent] }).compileComponents();
  });

  function placeholderFor(periodLabel: string): string {
    const fixture = TestBed.createComponent(SalesBreakdownCardComponent);
    fixture.componentRef.setInput('periodLabel', periodLabel);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input');
    return input?.getAttribute('placeholder') ?? '';
  }

  it('names the rows it searches, after the bucket column', () => {
    expect(placeholderFor('Day')).toBe('Search days');
    expect(placeholderFor('Hour')).toBe('Search hours');
    expect(placeholderFor('Week')).toBe('Search weeks');
    expect(placeholderFor('Month')).toBe('Search months');
    expect(placeholderFor('Year')).toBe('Search years');
  });

  it('never shows the word "bucket"', () => {
    for (const label of ['Day', 'Period', '']) {
      expect(placeholderFor(label).toLowerCase()).not.toContain('bucket');
    }
    expect(placeholderFor('Period')).toBe('Search');
  });
});
