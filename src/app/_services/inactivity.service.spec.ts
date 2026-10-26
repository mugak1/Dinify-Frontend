import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { routes } from '../app-routing.module';
import { KitchenComponent } from '../kitchen/kitchen.component';
import { AuthenticationService } from './authentication.service';
import { InactivityService } from './inactivity.service';

/**
 * KITCHEN-IDLE-00. The 15-minute idle logout counts only mouse, key, touch and
 * scroll input, so a kitchen board nobody touched during a quiet spell was
 * signed out and stopped showing orders. The kitchen shell now suspends idle
 * logout while it is mounted. These specs pin the timing contract of the
 * service and the hold through the real KitchenComponent.
 */

const MINUTE = 60 * 1000;
const WARNING_AT = 13 * MINUTE;
const LOGOUT_AT = 15 * MINUTE;

class FakeAuth {
  logouts = 0;
  logoutDueToInactivity(): void {
    this.logouts++;
  }
}

class FakeDialog {
  opened = 0;
  closed = 0;
  result = new Subject<unknown>();
  openModal(): Subject<unknown> {
    this.opened++;
    return this.result;
  }
  closeModal(): void {
    this.closed++;
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  template: '',
})
class BlankComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
})
class HostComponent {}

describe('InactivityService', () => {
  let service: InactivityService;
  let auth: FakeAuth;
  let dialog: FakeDialog;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthenticationService, useClass: FakeAuth },
        { provide: ConfirmDialogService, useClass: FakeDialog },
        provideRouter([
          {
            path: 'kitchen',
            component: KitchenComponent,
            children: [{ path: '', component: BlankComponent }],
          },
          { path: 'dashboard', component: BlankComponent },
        ]),
      ],
    });
    service = TestBed.inject(InactivityService);
    auth = TestBed.inject(AuthenticationService) as unknown as FakeAuth;
    dialog = TestBed.inject(ConfirmDialogService) as unknown as FakeDialog;
  });

  afterEach(() => service.stop());

  describe('CONTROL: an ordinary portal page is still signed out', () => {
    it('warns at 13 minutes and signs out at 15 minutes with no input', fakeAsync(() => {
      service.start();
      tick(WARNING_AT - 1);
      expect(dialog.opened).toBe(0);
      tick(1);
      expect(dialog.opened).toBe(1);
      tick(LOGOUT_AT - WARNING_AT);
      expect(auth.logouts).toBe(1);
    }));

    it('input restarts the window', fakeAsync(() => {
      service.start();
      tick(10 * MINUTE);
      document.dispatchEvent(new Event('keydown'));
      tick(10 * MINUTE);
      expect(auth.logouts).toBe(0);
      tick(5 * MINUTE);
      expect(auth.logouts).toBe(1);
    }));
  });

  describe('suspend()', () => {
    it('THE REGRESSION: a suspended session is never warned or signed out, however long it sits idle', fakeAsync(() => {
      service.start();
      const release = service.suspend();
      tick(8 * 60 * MINUTE);
      expect(dialog.opened).toBe(0);
      expect(auth.logouts).toBe(0);
      release();
    }));

    it('input while suspended does not restart the timers', fakeAsync(() => {
      service.start();
      const release = service.suspend();
      document.dispatchEvent(new Event('mousemove'));
      tick(LOGOUT_AT * 2);
      expect(auth.logouts).toBe(0);
      release();
    }));

    it('dismisses a warning that is already showing', fakeAsync(() => {
      service.start();
      tick(WARNING_AT);
      expect(dialog.opened).toBe(1);
      const release = service.suspend();
      expect(dialog.closed).toBe(1);
      tick(LOGOUT_AT);
      expect(auth.logouts).toBe(0);
      release();
    }));

    it('a hold taken before tracking starts still applies once it does', fakeAsync(() => {
      const release = service.suspend();
      service.start();
      tick(LOGOUT_AT * 2);
      expect(auth.logouts).toBe(0);
      release();
    }));

    it('releasing the last hold starts a FRESH 15-minute window', fakeAsync(() => {
      service.start();
      const release = service.suspend();
      tick(60 * MINUTE);
      release();
      expect(service.isSuspended).toBeFalse();
      tick(LOGOUT_AT - 1);
      expect(auth.logouts).toBe(0);
      tick(1);
      expect(auth.logouts).toBe(1);
    }));

    it('idle logout stays off until EVERY hold is released', fakeAsync(() => {
      service.start();
      const first = service.suspend();
      const second = service.suspend();
      first();
      tick(LOGOUT_AT * 2);
      expect(auth.logouts).toBe(0);
      second();
      tick(LOGOUT_AT);
      expect(auth.logouts).toBe(1);
    }));

    it('a release called twice cannot cancel another hold', fakeAsync(() => {
      service.start();
      const first = service.suspend();
      const second = service.suspend();
      first();
      first();
      expect(service.isSuspended).toBeTrue();
      tick(LOGOUT_AT * 2);
      expect(auth.logouts).toBe(0);
      second();
    }));

    it('releasing after sign-out schedules nothing', fakeAsync(() => {
      service.start();
      const release = service.suspend();
      service.stop();
      release();
      tick(LOGOUT_AT * 2);
      expect(auth.logouts).toBe(0);
    }));
  });

  describe('the kitchen board', () => {
    it('the real /kitchen route is hosted by KitchenComponent, which takes the hold', () => {
      const kitchen = routes.find(r => r.path === 'kitchen');
      expect(kitchen?.component).toBe(KitchenComponent);
    });

    it('THE REGRESSION: an untouched board is not signed out; leaving it restores idle logout', fakeAsync(() => {
      const fixture = TestBed.createComponent(HostComponent);
      const router = TestBed.inject(Router);
      service.start();

      router.navigateByUrl('/kitchen');
      tick();
      fixture.detectChanges();
      expect(service.isSuspended).toBeTrue();

      // A quiet afternoon with nobody touching the board.
      tick(4 * 60 * MINUTE);
      expect(dialog.opened).toBe(0);
      expect(auth.logouts).toBe(0);

      router.navigateByUrl('/dashboard');
      tick();
      fixture.detectChanges();
      expect(service.isSuspended).toBeFalse();

      tick(LOGOUT_AT);
      expect(auth.logouts).toBe(1);
    }));

    it('CONTROL: a portal page that is not the board is signed out as before', fakeAsync(() => {
      const fixture = TestBed.createComponent(HostComponent);
      const router = TestBed.inject(Router);
      service.start();

      router.navigateByUrl('/dashboard');
      tick();
      fixture.detectChanges();
      expect(service.isSuspended).toBeFalse();

      tick(LOGOUT_AT);
      expect(auth.logouts).toBe(1);
    }));
  });
});
