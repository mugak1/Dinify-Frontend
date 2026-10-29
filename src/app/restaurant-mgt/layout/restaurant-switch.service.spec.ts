import { TestBed } from '@angular/core/testing';
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { environment } from 'src/environments/environment';
import { AuthenticationService } from '../../_services/authentication.service';
import { ConfirmDialogService } from '../../_common/confirm-dialog.service';
import { ErrorInterceptor, SILENT_FAILURE } from '../../_helpers/error.interceptor';
import { ToastService } from '../../_shared/ui/toast/toast.service';
import { ConnectivityService } from '../../_services/connectivity.service';
import { RestaurantSwitchService } from './restaurant-switch.service';
import { SessionActionsService } from './session-actions.service';

/**
 * SHELL-FINISH-00, PR 3 — the venue switcher's one operation, through the REAL
 * ApiService and the REAL ErrorInterceptor, so the "silent, inline error" claim
 * is about the deployed chain rather than a stub.
 */
describe('RestaurantSwitchService', () => {
  const PROFILE_URL = `${environment.apiUrl}/api/${environment.version}/users/user-profile/`;
  const all = { dashboard: true, menu: true, tables: true, reviews: true, reports: true, settings: true, kitchen: true };
  const memberA = { restaurant_id: 'rest-a', restaurant: 'Baba House', roles: ['owner'], permissions: all };
  const memberB = { restaurant_id: 'rest-b', restaurant: 'Cafe Javas', roles: ['manager'], permissions: { ...all, menu: false } };
  const profile = (id: string, roles: any[]) => ({
    id, first_name: 'Ada', last_name: 'Okello', email: '', roles: [], phone_number: '', country: 'UG',
    prompt_password_change: false, other_names: '', restaurant_roles: roles,
  });

  let svc: RestaurantSwitchService;
  let httpMock: HttpTestingController;
  let dialog: ConfirmDialogService;
  let auth: jasmine.SpyObj<AuthenticationService> & { userValue: any; currentRestaurantRole: any };
  let toast: jasmine.SpyObj<ToastService>;
  let router: { url: string };

  beforeEach(() => {
    auth = jasmine.createSpyObj('AuthenticationService',
      ['switchRestaurantAndReload', 'retireAndReload', 'captureRequestOwner', 'ownerIsCurrent', 'logout'],
    ) as any;
    auth.userValue = { token: 't', profile: profile('user-1', [memberA, memberB]) };
    auth.currentRestaurantRole = memberA;
    auth.captureRequestOwner.and.returnValue(null);
    auth.switchRestaurantAndReload.and.returnValue(Promise.resolve('switched'));
    auth.retireAndReload.and.returnValue(Promise.resolve());
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning', 'info', 'clear', 'dismiss']);
    router = { url: '/menu/sections?s=1' };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useValue: auth },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        { provide: ConnectivityService, useValue: { isOffline: () => false } },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
        provideHttpClient(withXhr(), withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    svc = TestBed.inject(RestaurantSwitchService);
    httpMock = TestBed.inject(HttpTestingController);
    dialog = TestBed.inject(ConfirmDialogService);
  });

  afterEach(() => httpMock.verify());

  describe('the list it offers', () => {
    it('is the memberships this document knows, and the current one', () => {
      expect(svc.memberships().map(m => m.restaurant_id)).toEqual(['rest-a', 'rest-b']);
      expect(svc.currentRestaurantId()).toBe('rest-a');
    });
  });

  describe('requestSwitch — asks once', () => {
    it('choosing the current restaurant does nothing', () => {
      const open = spyOn(dialog, 'openModal');
      svc.requestSwitch(memberA as any);
      expect(open).not.toHaveBeenCalled();
      httpMock.expectNone(PROFILE_URL);
    });

    it('asks neutrally, says other tabs switch too, and reads the profile only on yes', () => {
      const open = spyOn(dialog, 'openModal').and.callThrough();
      svc.requestSwitch(memberB as any);
      const data = open.calls.mostRecent().args[0];
      expect(data.title).toBe('Switch to Cafe Javas?');
      expect(data.tone).toBe('neutral');
      expect(data.message).toContain('kitchen board');
      httpMock.expectNone(PROFILE_URL);
      dialog.resultSub.next({ action: 'yes' });
      httpMock.expectOne(PROFILE_URL);
    });

    it('cancel reads nothing and changes nothing', () => {
      svc.requestSwitch(memberB as any);
      dialog.resultSub.next({ action: 'no' });
      httpMock.expectNone(PROFILE_URL);
      expect(auth.switchRestaurantAndReload).not.toHaveBeenCalled();
    });

    it('with unsaved changes, the one dialog says so (destructive)', () => {
      TestBed.inject(SessionActionsService).trackRoutedPage({ isDirty: true });
      const open = spyOn(dialog, 'openModal').and.callThrough();
      svc.requestSwitch(memberB as any);
      const data = open.calls.mostRecent().args[0];
      expect(data.tone).toBe('destructive');
      expect(data.submitButtonText).toBe('Discard and switch');
      expect(data.cancelButtonText).toBe('Keep editing');
    });
  });

  describe('switchTo — the fresh profile decides', () => {
    it('reads the profile SILENTLY (the request carries SILENT_FAILURE)', () => {
      svc.switchTo('rest-b', 'Cafe Javas');
      const req = httpMock.expectOne(PROFILE_URL);
      expect(req.request.method).toBe('GET');
      expect(req.request.context.get(SILENT_FAILURE)).toBeTrue();
      req.flush({ status: 200, data: { profile: profile('user-1', [memberA, memberB]) } });
    });

    it('takes the membership FROM the fresh profile, by identity, and lands by the shared rule', () => {
      svc.switchTo('rest-b', 'Cafe Javas');
      const fresh = profile('user-1', [{ ...memberA }, { ...memberB }]);
      httpMock.expectOne(PROFILE_URL).flush({ status: 200, data: { profile: fresh } });
      expect(auth.switchRestaurantAndReload).toHaveBeenCalledTimes(1);
      const [p, m, landing] = auth.switchRestaurantAndReload.calls.mostRecent().args;
      expect(p).toEqual(fresh as any);
      expect(m).toBe(fresh.restaurant_roles[1] as any);
      // memberB cannot open Menu, so it is not kept.
      expect(landing).toBe('/dashboard');
    });

    it('refuses a membership the fresh profile no longer holds: inline error, nothing changed', () => {
      svc.switchTo('rest-b', 'Cafe Javas');
      httpMock.expectOne(PROFILE_URL).flush({ status: 200, data: { profile: profile('user-1', [memberA]) } });
      expect(auth.switchRestaurantAndReload).not.toHaveBeenCalled();
      expect(auth.retireAndReload).not.toHaveBeenCalled();
      expect(svc.error()).toBe('You no longer have access to Cafe Javas. Nothing was changed.');
      expect(svc.switching()).toBeFalse();
    });

    it('a failed read shows an inline error, no toast, and changes nothing', () => {
      svc.switchTo('rest-b', 'Cafe Javas');
      httpMock.expectOne(PROFILE_URL).flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });
      expect(svc.error()).toContain("Couldn't switch restaurants");
      expect(svc.switching()).toBeFalse();
      expect(auth.switchRestaurantAndReload).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it('a network failure (status 0) is silent too', () => {
      svc.switchTo('rest-b', 'Cafe Javas');
      httpMock.expectOne(PROFILE_URL).error(new ProgressEvent('error'), { status: 0 });
      expect(svc.error()).toContain('Check your connection');
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('a body that is not a profile is a failure, not a switch', () => {
      svc.switchTo('rest-b', 'Cafe Javas');
      httpMock.expectOne(PROFILE_URL).flush({ status: 200, data: { profile: { id: 'user-1' } } });
      expect(auth.switchRestaurantAndReload).not.toHaveBeenCalled();
      expect(svc.error()).not.toBeNull();
    });

    it('when the principal changed underneath, it reloads into what is stored and writes nothing', async () => {
      auth.switchRestaurantAndReload.and.returnValue(Promise.resolve('principal-changed'));
      auth.currentRestaurantRole = memberA;
      svc.switchTo('rest-b', 'Cafe Javas');
      httpMock.expectOne(PROFILE_URL).flush({ status: 200, data: { profile: profile('user-1', [memberA, memberB]) } });
      await Promise.resolve();
      expect(auth.retireAndReload).toHaveBeenCalledOnceWith('/menu');
    });
  });
});
