import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DialogComponent } from './dialog.component';

describe('DialogComponent', () => {
  // ── Behaviour (instance-level) ────────────────────────────────────────────
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

  // ── Rendered a11y wiring (attribute assertions) ───────────────────────────
  describe('rendered a11y', () => {
    let fixture: ComponentFixture<DialogComponent>;

    beforeEach(() => {
      TestBed.configureTestingModule({ imports: [DialogComponent] });
      fixture = TestBed.createComponent(DialogComponent);
      fixture.componentInstance.open = true;
      fixture.detectChanges();
    });

    function panel(): HTMLElement {
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
      expect(fixture.nativeElement.querySelector('[cdkTrapFocus]')).toBeTruthy();
    });

    it('caps the panel height and scrolls internally so footers stay reachable', () => {
      const p = panel();
      expect(p.className).toContain('max-h-[85vh]');
      expect(p.className).toContain('overflow-y-auto');
    });
  });

  // ── Accessible name (auto-detected from the first projected heading, or the
  //    explicit inputs). Uses a host so each scenario renders the panel fresh —
  //    the naming setter fires on panel creation. ────────────────────────────
  describe('accessible name', () => {
    @Component({
      standalone: true,
      imports: [DialogComponent],
      template: `<app-dn-dialog [open]="true" [ariaLabel]="ariaLabel" [ariaLabelledby]="ariaLabelledby">
        @if (withHeading) { <h2>My Title</h2> }
        <p>Body copy</p>
      </app-dn-dialog>`,
    })
    class HostComponent {
      ariaLabel?: string;
      ariaLabelledby?: string;
      withHeading = true;
    }

    function render(setup: (h: HostComponent) => void): HTMLElement {
      TestBed.configureTestingModule({ imports: [HostComponent] });
      const fixture = TestBed.createComponent(HostComponent);
      setup(fixture.componentInstance);
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('[role="dialog"]');
    }

    it('names the dialog from its first projected heading', () => {
      const p = render(() => {});
      const heading = p.querySelector('h2') as HTMLElement;
      expect(heading.id).toMatch(/^dn-overlay-title-\d+$/);
      expect(p.getAttribute('aria-labelledby')).toBe(heading.id);
    });

    it('lets an explicit ariaLabelledby win over auto-detection', () => {
      const p = render((h) => (h.ariaLabelledby = 'my-custom-title'));
      expect(p.getAttribute('aria-labelledby')).toBe('my-custom-title');
    });

    it('lets an explicit ariaLabel win and sets no aria-labelledby', () => {
      const p = render((h) => (h.ariaLabel = 'Delete section'));
      expect(p.getAttribute('aria-label')).toBe('Delete section');
      expect(p.hasAttribute('aria-labelledby')).toBeFalse();
    });

    it('leaves a heading-less, label-less dialog unnamed (benign)', () => {
      const p = render((h) => (h.withHeading = false));
      expect(p.hasAttribute('aria-labelledby')).toBeFalse();
      expect(p.hasAttribute('aria-label')).toBeFalse();
    });
  });
});
