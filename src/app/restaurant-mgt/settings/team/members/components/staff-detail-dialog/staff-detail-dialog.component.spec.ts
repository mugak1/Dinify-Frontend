import { TestBed } from '@angular/core/testing';

import { StaffDetailDialogComponent } from './staff-detail-dialog.component';

describe('StaffDetailDialogComponent', () => {
  function build(): StaffDetailDialogComponent {
    TestBed.configureTestingModule({ imports: [StaffDetailDialogComponent] });
    return TestBed.createComponent(StaffDetailDialogComponent).componentInstance;
  }

  it('creates', () => {
    expect(build()).toBeTruthy();
  });

  it('labels a legacy finance role gracefully', () => {
    const c = build();
    expect(c.roleLabel('finance')).toBe('Finance');
  });

  it('emits closed when closing', () => {
    const c = build();
    let closed = false;
    c.closed.subscribe(() => (closed = true));
    c.onClose();
    expect(closed).toBeTrue();
  });
});
