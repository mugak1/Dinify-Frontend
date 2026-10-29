import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthenticationService } from '../../_services/authentication.service';
import { LocalStorageService } from '../../_services/storage/local-storage.service';
import { ConfirmDialogService } from '../../_common/confirm-dialog.service';
import { unsavedChangesGuard } from '../../_helpers/unsaved-changes.guard';
import { RestaurantMgtComponent } from '../restaurant-mgt.component';
import { SessionActionsService } from './session-actions.service';

/** A stand-in for a Settings section page: the HasUnsavedChanges contract. */
@Component({ changeDetection: ChangeDetectionStrategy.Eager, standalone: true, template: 'settings page' })
class DirtyPageComponent {
  isDirty = true;
}

@Component({ changeDetection: ChangeDetectionStrategy.Eager, standalone: true, template: 'clean page' })
class CleanPageComponent {}

describe('SessionActionsService — one sign-out path, one confirmation', () => {
  let logout: jasmine.Spy;
  let dialog: ConfirmDialogService;
  let openModal: jasmine.Spy;

  const answer = (action: 'yes' | 'no') => dialog.resultSub.next({ action });

  beforeEach(() => {
    logout = jasmine.createSpy('logout');
    TestBed.configureTestingModule({
      providers: [{ provide: AuthenticationService, useValue: { logout } }],
    });
    dialog = TestBed.inject(ConfirmDialogService);
    openModal = spyOn(dialog, 'openModal').and.callThrough();
  });

  it('asks once, neutrally, and signs out on yes', () => {
    const svc = TestBed.inject(SessionActionsService);
    svc.confirmSignOut();
    expect(openModal).toHaveBeenCalledTimes(1);
    const data = openModal.calls.mostRecent().args[0];
    expect(data.title).toBe('Sign out of Dinify?');
    expect(data.tone).toBe('neutral');
    expect(data.submitButtonText).toBe('Sign out');
    expect(logout).not.toHaveBeenCalled();
    answer('yes');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(dialog.showModal.value).toBeFalse();
  });

  it('cancel signs nobody out', () => {
    TestBed.inject(SessionActionsService).confirmSignOut();
    answer('no');
    expect(logout).not.toHaveBeenCalled();
    answer('yes'); // a late answer to a dialog already closed does nothing
    expect(logout).not.toHaveBeenCalled();
  });

  it('with unsaved changes on the page, the ONE dialog says so (destructive)', () => {
    const svc = TestBed.inject(SessionActionsService);
    svc.trackRoutedPage({ isDirty: true });
    svc.confirmSignOut();
    expect(openModal).toHaveBeenCalledTimes(1);
    const data = openModal.calls.mostRecent().args[0];
    expect(data.tone).toBe('destructive');
    expect(data.message).toContain('unsaved changes');
    expect(data.submitButtonText).toBe('Discard and sign out');
    expect(data.cancelButtonText).toBe('Keep editing');
    answer('yes');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(openModal).withContext('never a second, stacked dialog').toHaveBeenCalledTimes(1);
  });

  it('a page that is not dirty (or reports nothing) is not treated as dirty', () => {
    const svc = TestBed.inject(SessionActionsService);
    svc.trackRoutedPage({ isDirty: false });
    expect(svc.hasUnsavedChanges()).toBeFalse();
    svc.trackRoutedPage({});
    expect(svc.hasUnsavedChanges()).toBeFalse();
    svc.trackRoutedPage(null);
    expect(svc.hasUnsavedChanges()).toBeFalse();
  });
});

describe('SessionActionsService — the shell records the routed Settings page', () => {
  beforeEach(() => {
    const auth = {
      logout: jasmine.createSpy('logout'),
      canAccess: () => true,
      firstAccessibleRoute: () => '/dashboard',
      userValue: { profile: { first_name: 'Ada', last_name: 'Okello' } },
      currentRestaurantRole: null,
      currentRestaurant: null,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useValue: auth },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {} } },
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideRouter([
          {
            path: '',
            component: RestaurantMgtComponent,
            children: [
              // The real shape: `settings` is a componentless parent, so its section
              // page renders in the SHELL's outlet — the one the shell records.
              { path: 'settings', children: [
                { path: 'availability', component: DirtyPageComponent, canDeactivate: [unsavedChangesGuard] },
              ] },
              { path: 'dashboard', component: CleanPageComponent },
            ],
          },
        ]),
      ],
    });
  });

  afterEach(() => document.body.classList.remove('dn-drawer-open'));

  it('a dirty Settings section page is seen through the componentless parent', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/settings/availability');
    const svc = TestBed.inject(SessionActionsService);
    expect(svc.hasUnsavedChanges()).toBeTrue();
  });

  it('a page without the contract is clean', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dashboard');
    expect(TestBed.inject(SessionActionsService).hasUnsavedChanges()).toBeFalse();
  });

  it('signing out from a dirty Settings page asks once: the guard never runs, because sign-out is a page load', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/settings/availability');
    const dialog = TestBed.inject(ConfirmDialogService);
    const openModal = spyOn(dialog, 'openModal').and.callThrough();
    TestBed.inject(SessionActionsService).confirmSignOut();
    dialog.resultSub.next({ action: 'yes' });
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(openModal.calls.mostRecent().args[0].tone).toBe('destructive');
    expect((TestBed.inject(AuthenticationService) as any).logout).toHaveBeenCalledTimes(1);
  });
});
