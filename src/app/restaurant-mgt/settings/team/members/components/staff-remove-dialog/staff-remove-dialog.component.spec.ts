import { TestBed } from '@angular/core/testing';

import { StaffRemoveDialogComponent } from './staff-remove-dialog.component';

describe('StaffRemoveDialogComponent', () => {
  function build(): StaffRemoveDialogComponent {
    TestBed.configureTestingModule({ imports: [StaffRemoveDialogComponent] });
    return TestBed.createComponent(StaffRemoveDialogComponent).componentInstance;
  }

  it('resets the reason each time it opens', () => {
    const c = build();
    c.reason = 'stale';
    c.submitted = true;
    c.open = true;
    c.ngOnChanges({ open: { currentValue: true } as any });
    expect(c.reason).toBe('');
    expect(c.submitted).toBeFalse();
  });

  it('requires a reason before confirming', () => {
    const c = build();
    const spy = jasmine.createSpy('confirmed');
    c.confirmed.subscribe(spy);
    c.reason = '   ';
    c.onConfirm();
    expect(spy).not.toHaveBeenCalled();
    expect(c.submitted).toBeTrue();
  });

  it('emits the trimmed reason on confirm', () => {
    const c = build();
    const spy = jasmine.createSpy('confirmed');
    c.confirmed.subscribe(spy);
    c.reason = '  no longer with the team  ';
    c.onConfirm();
    expect(spy).toHaveBeenCalledWith('no longer with the team');
  });

  it('does not cancel while a removal is in flight', () => {
    const c = build();
    let cancelled = false;
    c.cancelled.subscribe(() => (cancelled = true));
    c.removing = true;
    c.onCancel();
    expect(cancelled).toBeFalse();
  });
});
