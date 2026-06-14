import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { ConnectivityService } from './connectivity.service';

describe('ConnectivityService', () => {
  // Shadow navigator.onLine with an own accessor we control (the prototype
  // getter isn't reliably spy-able across browsers). Each test sets it before
  // the service is first injected so the constructor seed reads our value.
  function setOnline(value: boolean): void {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
  }

  afterEach(() => {
    // Drop our own property so the real prototype getter is restored.
    delete (navigator as { onLine?: boolean }).onLine;
  });

  it('seeds offline=false when the browser starts online', () => {
    setOnline(true);
    expect(TestBed.inject(ConnectivityService).isOffline()).toBeFalse();
  });

  it('seeds offline=true when the browser starts offline', () => {
    setOnline(false);
    expect(TestBed.inject(ConnectivityService).isOffline()).toBeTrue();
  });

  it('flips to offline after a debounced offline event', fakeAsync(() => {
    setOnline(true);
    const svc = TestBed.inject(ConnectivityService);
    expect(svc.isOffline()).toBeFalse();

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    tick(399);
    expect(svc.isOffline()).toBeFalse(); // still inside the settle window
    tick(1);
    expect(svc.isOffline()).toBeTrue();
  }));

  it('clears offline after a debounced online event', fakeAsync(() => {
    setOnline(false);
    const svc = TestBed.inject(ConnectivityService);
    expect(svc.isOffline()).toBeTrue();

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    tick(400);
    expect(svc.isOffline()).toBeFalse();
  }));

  it('collapses a flapping signal to its final state', fakeAsync(() => {
    setOnline(true);
    const svc = TestBed.inject(ConnectivityService);

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    tick(100);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    tick(100);
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    tick(400); // only the last event survives the debounce

    expect(svc.isOffline()).toBeTrue();
  }));
});
