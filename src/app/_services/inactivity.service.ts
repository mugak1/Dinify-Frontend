import { Injectable, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { ConfirmDialogService } from '../_common/confirm-dialog.service';
import { AuthenticationService } from './authentication.service';

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_BEFORE_TIMEOUT_MS = 2 * 60 * 1000;
const THROTTLE_MS = 500;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

@Injectable({ providedIn: 'root' })
export class InactivityService {
  private warningTimer: any = null;
  private logoutTimer: any = null;
  private lastFiredAt = 0;
  private isRunning = false;
  private warningOpen = false;
  private dialogResultSub: Subscription | null = null;

  constructor(
    private ngZone: NgZone,
    private auth: AuthenticationService,
    private dialog: ConfirmDialogService,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFiredAt = 0;
    this.ngZone.runOutsideAngular(() => {
      for (const evt of ACTIVITY_EVENTS) {
        document.addEventListener(evt, this.onActivity, { passive: true, capture: true });
      }
    });
    this.scheduleTimers();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    for (const evt of ACTIVITY_EVENTS) {
      document.removeEventListener(evt, this.onActivity, { capture: true } as any);
    }
    this.clearTimers();
    this.dismissWarning();
  }

  // Leading-edge throttle: first event in any THROTTLE_MS window fires immediately;
  // subsequent events within the window are dropped. NOT a debounce — must not delay
  // the timer reset until activity stops.
  private onActivity = () => {
    const now = Date.now();
    if (now - this.lastFiredAt < THROTTLE_MS) return;
    this.lastFiredAt = now;
    this.scheduleTimers();
    if (this.warningOpen) {
      this.ngZone.run(() => this.dismissWarning());
    }
  };

  private scheduleTimers(): void {
    this.clearTimers();
    this.warningTimer = setTimeout(() => {
      this.ngZone.run(() => this.showWarning());
    }, INACTIVITY_TIMEOUT_MS - WARNING_BEFORE_TIMEOUT_MS);
    this.logoutTimer = setTimeout(() => {
      this.ngZone.run(() => this.triggerLogout());
    }, INACTIVITY_TIMEOUT_MS);
  }

  private clearTimers(): void {
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.logoutTimer) {
      clearTimeout(this.logoutTimer);
      this.logoutTimer = null;
    }
  }

  private showWarning(): void {
    if (this.warningOpen) return;
    this.warningOpen = true;
    this.dialogResultSub?.unsubscribe();
    // Document-level listeners still fire while the dialog is open (the backdrop
    // doesn't stopPropagation), so mouse/key activity inside the dialog will reset
    // timers naturally. The subscription below is a belt-and-suspenders fallback
    // for the explicit "Stay signed in" / Cancel button presses.
    this.dialogResultSub = this.dialog.openModal({
      title: "You'll be logged out soon",
      message: "You'll be logged out in 2 minutes due to inactivity. Move your mouse or press any key to stay signed in.",
      submitButtonText: 'Stay signed in',
      cancelButtonText: 'Stay signed in',
    }).subscribe((result: any) => {
      if (result?.action) {
        this.lastFiredAt = Date.now();
        this.scheduleTimers();
        this.dismissWarning();
      }
    });
  }

  private dismissWarning(): void {
    if (!this.warningOpen) return;
    this.warningOpen = false;
    this.dialogResultSub?.unsubscribe();
    this.dialogResultSub = null;
    this.dialog.closeModal();
  }

  private triggerLogout(): void {
    this.dismissWarning();
    this.auth.logoutDueToInactivity();
  }
}
