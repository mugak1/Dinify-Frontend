import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';
import { filter, map, take, tap } from 'rxjs/operators';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';

/**
 * A component that tracks its own unsaved-changes state. The settings section
 * pages already expose this `isDirty` getter to drive their in-page "Unsaved
 * changes" save bar; the guard reuses it to also block navigation away.
 */
export interface HasUnsavedChanges {
  readonly isDirty: boolean;
}

/**
 * Route `canDeactivate` guard: when leaving a page that has unsaved changes,
 * confirm first. Returns `true` immediately when the component is pristine.
 * Otherwise it opens the shared confirm dialog — which is created at app root
 * (`app.component.ts`), so it renders over any view — and resolves to the user's
 * choice (Discard = leave, Keep editing = stay).
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component?.isDirty) {
    return true;
  }

  const dialog = inject(ConfirmDialogService);
  return dialog
    .openModal({
      title: 'Discard changes?',
      message: 'You have unsaved changes that will be lost if you leave this page.',
      submitButtonText: 'Discard',
      cancelButtonText: 'Keep editing',
    })
    .pipe(
      // The service's result subject replays `{}` on subscribe; wait for a real
      // yes/no choice, resolve it to a boolean, then dismiss the dialog.
      filter((r: any) => r?.action === 'yes' || r?.action === 'no'),
      take(1),
      map((r: any) => r.action === 'yes'),
      tap(() => dialog.closeModal()),
    ) as Observable<boolean>;
};
