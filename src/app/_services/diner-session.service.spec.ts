import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { DinerSessionService } from './diner-session.service';
import { SessionStorageService } from './storage/session-storage.service';
import { WINDOW } from './storage/window.token';
import { STORAGE_KEY_PREFIX } from './storage/storage-key-prefix.token';

describe('DinerSessionService', () => {
  let service: DinerSessionService;
  let storage: SessionStorageService;

  beforeEach(() => {
    window.sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
        SessionStorageService,
        DinerSessionService,
      ],
    });
    service = TestBed.inject(DinerSessionService);
    storage = TestBed.inject(SessionStorageService);
  });

  afterEach(() => window.sessionStorage.clear());

  it('stores and exposes the credential and session token', () => {
    service.setCredential('QR-CRED');
    service.setToken('SESS-TOK');

    expect(service.credential).toBe('QR-CRED');
    expect(service.token).toBe('SESS-TOK');
    expect(service.hasCredential()).toBeTrue();
    expect(service.hasSession()).toBeTrue();
    // Persisted for reload survival.
    expect(storage.getItem<string>('diner.credential')).toBe('QR-CRED');
    expect(storage.getItem<string>('diner.session')).toBe('SESS-TOK');
  });

  it('ignores empty credential/token writes', () => {
    service.setCredential('   ');
    service.setToken('');
    expect(service.hasCredential()).toBeFalse();
    expect(service.hasSession()).toBeFalse();
  });

  it('captures the session token from a scan response (data.session_token)', () => {
    service.captureScan({ data: { id: 't1', session_token: 'FROM-SCAN' } });
    expect(service.token).toBe('FROM-SCAN');
  });

  it('captureScan is a no-op when the response carries no session token', () => {
    service.setToken('EXISTING');
    service.captureScan({ data: { id: 't1' } });
    expect(service.token).toBe('EXISTING');
  });

  it('expireSession drops the token but keeps the credential (re-mintable)', () => {
    service.setCredential('QR-CRED');
    service.setToken('SESS');

    service.expireSession();

    expect(service.hasSession()).toBeFalse();
    expect(service.credential).toBe('QR-CRED');
    expect(service.needsRescan()).toBeFalse();
    expect(storage.getItem<string>('diner.credential')).toBe('QR-CRED');
  });

  it('invalidateCredential wipes everything and flags a rescan', () => {
    service.setCredential('QR-CRED');
    service.setToken('SESS');

    service.invalidateCredential();

    expect(service.hasSession()).toBeFalse();
    expect(service.hasCredential()).toBeFalse();
    expect(service.needsRescan()).toBeTrue();
    expect(storage.getItem<string>('diner.credential')).toBeNull();
    expect(storage.getItem<string>('diner.session')).toBeNull();
  });

  it('a fresh credential clears a pending rescan flag', () => {
    service.invalidateCredential();
    expect(service.needsRescan()).toBeTrue();

    service.setCredential('NEW-CRED');
    expect(service.needsRescan()).toBeFalse();
  });

  it('retainSessionThrough keeps the capability alive across a blanket sessionStorage.clear()', () => {
    service.setCredential('QR-CRED');
    service.setToken('SESS');

    // Simulates the post-checkout reset that wipes Table/basket/etc.
    service.retainSessionThrough(() => storage.clear());

    expect(service.credential).toBe('QR-CRED');
    expect(service.token).toBe('SESS');
    expect(storage.getItem<string>('diner.session')).toBe('SESS');
    expect(storage.getItem<string>('diner.credential')).toBe('QR-CRED');
  });

  it('rehydrates the capability from sessionStorage on (re)construction — survives a reload', () => {
    service.setCredential('QR-CRED');
    service.setToken('SESS');

    // A page reload re-instantiates the service; it must seed from storage.
    const reloaded = new DinerSessionService(storage);

    expect(reloaded.credential).toBe('QR-CRED');
    expect(reloaded.token).toBe('SESS');
  });

  describe('isSessionExpired', () => {
    it('matches the backend expiry message (string form from the interceptor)', () => {
      expect(service.isSessionExpired(DinerSessionService.EXPIRED_MESSAGE)).toBeTrue();
      expect(service.isSessionExpired('A diner capability is required.')).toBeTrue();
      expect(service.isSessionExpired('Invalid diner capability.')).toBeTrue();
    });

    it('matches a raw HttpErrorResponse 400 with the expiry body', () => {
      const err = new HttpErrorResponse({ status: 400, error: { message: DinerSessionService.EXPIRED_MESSAGE } });
      expect(service.isSessionExpired(err)).toBeTrue();
    });

    it('does not match unrelated errors', () => {
      expect(service.isSessionExpired('Sorry, sold out')).toBeFalse();
      expect(service.isSessionExpired(new HttpErrorResponse({ status: 400, error: { message: 'Bad request' } }))).toBeFalse();
      expect(service.isSessionExpired(null)).toBeFalse();
    });
  });

  describe('isCredentialDenied', () => {
    it('matches the capability-denied 404 (string and HttpErrorResponse)', () => {
      expect(service.isCredentialDenied('Not found.')).toBeTrue();
      expect(service.isCredentialDenied(new HttpErrorResponse({ status: 404, error: { message: 'Not found.' } }))).toBeTrue();
    });

    it('does NOT treat a resource miss ("Order not found.") as a credential denial', () => {
      expect(service.isCredentialDenied(new HttpErrorResponse({ status: 404, error: { message: 'Order not found.' } }))).toBeFalse();
      expect(service.isCredentialDenied('Order not found.')).toBeFalse();
    });
  });

  it('never logs the credential or token', () => {
    const log = spyOn(console, 'log');
    const warn = spyOn(console, 'warn');
    const error = spyOn(console, 'error');

    service.setCredential('SECRET-CRED');
    service.setToken('SECRET-TOK');
    service.captureScan({ data: { session_token: 'SECRET-TOK-2' } });
    service.isSessionExpired('x');
    service.isCredentialDenied('y');
    service.expireSession();
    service.invalidateCredential();

    const logged = [...log.calls.allArgs(), ...warn.calls.allArgs(), ...error.calls.allArgs()]
      .flat()
      .map(String)
      .join(' ');
    expect(logged).not.toContain('SECRET');
  });
});
