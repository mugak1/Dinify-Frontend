import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { unsavedChangesGuard, HasUnsavedChanges } from './unsaved-changes.guard';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';

describe('unsavedChangesGuard', () => {
  let resultSub: Subject<any>;
  let dialog: { openModal: jasmine.Spy; closeModal: jasmine.Spy };

  beforeEach(() => {
    resultSub = new Subject<any>();
    dialog = {
      openModal: jasmine.createSpy('openModal').and.returnValue(resultSub),
      closeModal: jasmine.createSpy('closeModal'),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: ConfirmDialogService, useValue: dialog }],
    });
  });

  function run(component: HasUnsavedChanges) {
    return TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, null as any, null as any, null as any),
    );
  }

  it('allows navigation immediately when the component is pristine (no prompt)', () => {
    const result = run({ isDirty: false });
    expect(result).toBe(true);
    expect(dialog.openModal).not.toHaveBeenCalled();
  });

  it('prompts when dirty and resolves TRUE (leave) when the user discards', (done) => {
    const result = run({ isDirty: true }) as any;
    expect(dialog.openModal).toHaveBeenCalled();

    result.subscribe((leave: boolean) => {
      expect(leave).toBe(true);
      expect(dialog.closeModal).toHaveBeenCalled();
      done();
    });

    resultSub.next({});                 // service replays {} first — must be ignored
    resultSub.next({ action: 'yes' });
  });

  it('prompts when dirty and resolves FALSE (stay) when the user keeps editing', (done) => {
    const result = run({ isDirty: true }) as any;

    result.subscribe((leave: boolean) => {
      expect(leave).toBe(false);
      expect(dialog.closeModal).toHaveBeenCalled();
      done();
    });

    resultSub.next({ action: 'no' });
  });
});
