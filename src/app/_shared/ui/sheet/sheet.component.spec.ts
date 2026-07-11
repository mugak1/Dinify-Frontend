import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SheetComponent } from './sheet.component';

describe('SheetComponent', () => {
  let fixture: ComponentFixture<SheetComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SheetComponent] });
    fixture = TestBed.createComponent(SheetComponent);
    fixture.componentInstance.open = true;
  });

  function panel(): HTMLElement {
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[role="dialog"]');
  }

  it('renders a focus-trapped modal panel focused on the container', () => {
    const p = panel();
    expect(p).toBeTruthy();
    expect(p.getAttribute('aria-modal')).toBe('true');
    expect(p.getAttribute('tabindex')).toBe('-1');
    expect(fixture.nativeElement.querySelector('[cdkFocusInitial]')).toBe(p);
    expect(fixture.nativeElement.querySelector('[cdkTrapFocus]')).toBeTruthy();
  });

  it('reflects ariaLabel onto the panel', () => {
    fixture.componentInstance.ariaLabel = 'Review details';
    expect(panel().getAttribute('aria-label')).toBe('Review details');
  });

  it('still closes on Escape and backdrop click', () => {
    const c = fixture.componentInstance;
    let closed = 0;
    c.closed.subscribe(() => closed++);

    c.onEscape();
    expect(closed).toBe(1);
    expect(c.open).toBeFalse();

    c.open = true;
    c.close();
    expect(closed).toBe(2);
    expect(c.open).toBeFalse();
  });
});
