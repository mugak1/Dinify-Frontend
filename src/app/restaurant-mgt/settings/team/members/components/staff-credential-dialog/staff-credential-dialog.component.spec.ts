import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StaffCredentialDialogComponent } from './staff-credential-dialog.component';
import { ToastService } from 'src/app/_shared/ui/toast/toast.service';

describe('StaffCredentialDialogComponent', () => {
  let component: StaffCredentialDialogComponent;
  let fixture: ComponentFixture<StaffCredentialDialogComponent>;
  let toast: jasmine.SpyObj<ToastService>;

  function mockClipboard(writeText: jasmine.Spy): void {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  }

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', [
      'success',
      'error',
      'warning',
      'info',
      'clear',
    ]);
    TestBed.configureTestingModule({
      imports: [StaffCredentialDialogComponent],
      providers: [{ provide: ToastService, useValue: toast }],
    });
    fixture = TestBed.createComponent(StaffCredentialDialogComponent);
    component = fixture.componentInstance;
    component.tempPassword = 'TMP-SECRET';
  });

  it('copies the password and shows a success toast', async () => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo(undefined);
    mockClipboard(writeText);
    await component.copy();
    expect(writeText).toHaveBeenCalledWith('TMP-SECRET');
    expect(toast.success).toHaveBeenCalledWith('Password copied to clipboard');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on copy failure keeps the password selectable and warns to copy manually (never a success toast)', async () => {
    const writeText = jasmine
      .createSpy('writeText')
      .and.rejectWith(new Error('denied'));
    mockClipboard(writeText);
    // Stub the password input ref so we can assert it is re-selected for manual copy.
    const select = jasmine.createSpy('select');
    component.pwInput = { nativeElement: { select } } as any;

    await component.copy();

    expect(select).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Copy failed — select and copy the password manually',
    );
    expect(toast.success).not.toHaveBeenCalled();
    // The credential is still present — not lost.
    expect(component.tempPassword).toBe('TMP-SECRET');
  });

  it('gates dismissal on the acknowledgement', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);

    component.acknowledged = false;
    component.done();
    expect(closed).toBe(0);

    component.acknowledged = true;
    component.done();
    expect(closed).toBe(1);
  });

  it('resets the acknowledgement each time it (re)opens', () => {
    component.acknowledged = true;
    component.open = true;
    component.ngOnChanges({ open: { currentValue: true } as any });
    expect(component.acknowledged).toBeFalse();
  });
});
