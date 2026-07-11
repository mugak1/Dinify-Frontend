import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DialogComponent } from './dialog.component';

describe('DialogComponent', () => {
  // ── Behaviour (instance-level, unchanged from before) ─────────────────────
  function build(): DialogComponent {
    TestBed.configureTestingModule({ imports: [DialogComponent] });
    return TestBed.createComponent(DialogComponent).componentInstance;
  }

  it('closes on backdrop click and Escape by default', () => {
    const c = build();
    let closed = 0;
    c.closed.subscribe(() => closed++);

    c.open = true;
    c.onBackdrop();
    expect(closed).toBe(1);
    expect(c.open).toBeFalse();

    c.open = true;
    c.onEscape();
    expect(closed).toBe(2);
    expect(c.open).toBeFalse();
  });

  it('does not close on backdrop click or Escape when disableClose is true', () => {
    const c = build();
    c.disableClose = true;
    c.open = true;
    let closed = 0;
    c.closed.subscribe(() => closed++);

    c.onBackdrop();
    c.onEscape();

    expect(closed).toBe(0);
    expect(c.open).toBeTrue();
  });

  // ── Rendered accessibility (attribute assertions — not runtime focus, to
  //    avoid headless-focus flakiness) ──────────────────────────────────────
  describe('rendered a11y', () => {
    let fixture: ComponentFixture<DialogComponent>;

    beforeEach(() => {
      TestBed.configureTestingModule({ imports: [DialogComponent] });
      fixture = TestBed.createComponent(DialogComponent);
      fixture.componentInstance.open = true;
    });

    function panel(): HTMLElement {
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('[role="dialog"]');
    }

    it('marks the panel as a modal dialog focused on the container (never a footer button)', () => {
      const p = panel();
      expect(p).toBeTruthy();
      expect(p.getAttribute('aria-modal')).toBe('true');
      expect(p.getAttribute('tabindex')).toBe('-1');
      expect(fixture.nativeElement.querySelector('[cdkFocusInitial]')).toBe(p);
    });

    it('traps focus on the wrapper with auto-capture', () => {
      panel();
      expect(fixture.nativeElement.querySelector('[cdkTrapFocus]')).toBeTruthy();
    });

    it('caps the panel height and scrolls internally so footers stay reachable', () => {
      const p = panel();
      expect(p.className).toContain('max-h-[85vh]');
      expect(p.className).toContain('overflow-y-auto');
    });

    it('reflects ariaLabel / ariaLabelledby onto the panel', () => {
      fixture.componentInstance.ariaLabel = 'Delete section';
      let p = panel();
      expect(p.getAttribute('aria-label')).toBe('Delete section');

      fixture.componentInstance.ariaLabel = undefined;
      fixture.componentInstance.ariaLabelledby = 'section-delete-title';
      p = panel();
      expect(p.getAttribute('aria-labelledby')).toBe('section-delete-title');
    });

    it('emits no naming attributes when neither input is set', () => {
      const p = panel();
      expect(p.hasAttribute('aria-label')).toBeFalse();
      expect(p.hasAttribute('aria-labelledby')).toBeFalse();
    });
  });
});
