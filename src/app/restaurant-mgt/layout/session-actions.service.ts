import { Injectable, inject } from '@angular/core';
import { filter, take } from 'rxjs/operators';
import { AuthenticationService } from '../../_services/authentication.service';
import { ConfirmDialogService } from '../../_common/confirm-dialog.service';
import { ConfirmaDialogData } from '../../_models/app.models';

/**
 * Shell-level session actions that end in a FULL PAGE LOAD (SHELL-FINISH-00, PR 2).
 *
 * ONE SIGN-OUT PATH, ONE CONFIRMATION. The avatar menu and the /account page's
 * button both call `confirmSignOut()`; neither calls `auth.logout()` directly.
 * (The shell's old confirm-then-logout was bound to an output nothing emitted, and
 * /account signed out with no confirmation at all.)
 *
 * ASKED ONCE ABOUT UNSAVED CHANGES. A sign-out is a hard redirect, so the route's
 * `unsavedChangesGuard` never runs — there is no router navigation for it to
 * guard. Rather than navigate first (which would stack the guard's dialog on top
 * of this one), the shell records the component its outlet activated, and this
 * service folds "you have unsaved changes" into the ONE dialog it shows.
 *
 * The settings routes have no component on their parent route, so the
 * guarded section page is the shell outlet's own component — the one recorded here.
 */
@Injectable({ providedIn: 'root' })
export class SessionActionsService {
  private readonly auth = inject(AuthenticationService);
  private readonly dialog = inject(ConfirmDialogService);

  private routedPage: unknown = null;

  /** Called by the shell's <router-outlet> (activate)/(deactivate). */
  trackRoutedPage(component: unknown): void {
    this.routedPage = component;
  }

  /** The page on screen reports unsaved edits (the HasUnsavedChanges contract). */
  hasUnsavedChanges(): boolean {
    const page = this.routedPage as { isDirty?: unknown } | null;
    return page?.isDirty === true;
  }

  confirmSignOut(): void {
    const dirty = this.hasUnsavedChanges();
    const data: ConfirmaDialogData = dirty
      ? {
          title: 'Sign out of Dinify?',
          message: 'You have unsaved changes on this page. They will be lost if you sign out.',
          tone: 'destructive',
          submitButtonText: 'Discard and sign out',
          cancelButtonText: 'Keep editing',
        }
      : {
          title: 'Sign out of Dinify?',
          message: 'You can sign back in at any time.',
          tone: 'neutral',
          submitButtonText: 'Sign out',
        };
    this.confirm(data, () => this.auth.logout());
  }

  /**
   * Open the shared confirm dialog and run `onYes` on a yes. The service's result
   * subject replays `{}` on subscribe, so wait for a real choice.
   */
  confirm(data: ConfirmaDialogData, onYes: () => void): void {
    this.dialog
      .openModal(data)
      .pipe(
        filter((r: any) => r?.action === 'yes' || r?.action === 'no'),
        take(1),
      )
      .subscribe((r: any) => {
        this.dialog.closeModal();
        if (r.action === 'yes') onYes();
      });
  }
}
