import { TestBed } from '@angular/core/testing';

import { DialogComponent } from './dialog.component';

describe('DialogComponent', () => {
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
});
