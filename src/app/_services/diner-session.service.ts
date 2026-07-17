import { Injectable, signal } from '@angular/core';
import { SessionStorageService } from './storage/session-storage.service';

/**
 * Owns the anonymous diner "table-session capability" introduced by backend
 * PR 7A. Two opaque, signed tokens flow through the diner journey:
 *
 *  - the **QR credential** — long-lived, read once from the scanned QR URL
 *    (`?c=<credential>`), exchanged at the protected table-scan endpoint for a
 *    session. It is the ONLY thing that starts a session (a raw table UUID no
 *    longer does).
 *  - the **table session** — short-lived (6h backend TTL), minted by a scan and
 *    attached (via `DinerSessionInterceptor`) to every later diner request in
 *    the `X-Diner-Session` header.
 *
 * Both live in sessionStorage (per-tab, cleared on tab close, survives reloads —
 * the safest storage compatible with page reloads) AND in memory (signals) so
 * the interceptor can read them synchronously. This is a channel completely
 * separate from staff auth (`localStorage['user']`); nothing here is ever logged
 * or placed in a URL/body/analytics payload.
 */
@Injectable({ providedIn: 'root' })
export class DinerSessionService {
  private static readonly CREDENTIAL_KEY = 'diner.credential';
  private static readonly SESSION_KEY = 'diner.session';

  /** The backend's fixed expiry message (a TTL lapse — the credential may still
   *  be good, so a re-scan can re-mint). Matched verbatim. */
  static readonly EXPIRED_MESSAGE =
    'Your table session has expired. Please rescan the QR code.';

  /** 400 messages that mean "the session token we sent is no longer usable"
   *  (expired / missing / malformed / unsupported). All are recoverable by
   *  re-scanning with the retained credential. */
  private static readonly SESSION_INVALID_400 = new Set<string>([
    DinerSessionService.EXPIRED_MESSAGE,
    'A diner capability is required.',
    'Invalid diner capability.',
    'Unsupported diner capability.',
  ]);

  /** The non-disclosing 404 body the backend returns for a denied capability
   *  (unknown table / stale QR generation / unavailable table). Distinct from a
   *  resource miss like "Order not found." — only this one invalidates the QR. */
  private static readonly CAPABILITY_DENIED_404 = 'Not found.';

  private readonly _credential = signal<string | null>(null);
  private readonly _token = signal<string | null>(null);

  /** True once the capability is dead and only a fresh PHYSICAL QR scan can
   *  recover it (QR regenerated / table withdrawn). The diner shell renders the
   *  rescan panel while this is set. */
  readonly needsRescan = signal<boolean>(false);

  constructor(private readonly storage: SessionStorageService) {
    // Seed from sessionStorage so a page reload rehydrates the capability
    // without needing the QR URL again.
    this._credential.set(this.storage.getItem<string>(DinerSessionService.CREDENTIAL_KEY));
    this._token.set(this.storage.getItem<string>(DinerSessionService.SESSION_KEY));
  }

  get credential(): string | null {
    return this._credential();
  }

  get token(): string | null {
    return this._token();
  }

  hasCredential(): boolean {
    return !!this._credential();
  }

  hasSession(): boolean {
    return !!this._token();
  }

  /** Record the opaque QR credential read from the scanned URL. Clears any stale
   *  "needs rescan" state — a fresh credential is a fresh start. */
  setCredential(credential: string | null | undefined): void {
    const c = (credential ?? '').trim();
    if (!c) return;
    this._credential.set(c);
    this.storage.setItem(DinerSessionService.CREDENTIAL_KEY, c);
    this.needsRescan.set(false);
  }

  /** Persist a freshly-minted session token. */
  setToken(token: string | null | undefined): void {
    const t = (token ?? '').trim();
    if (!t) return;
    this._token.set(t);
    this.storage.setItem(DinerSessionService.SESSION_KEY, t);
  }

  /** Pull the session token out of a table-scan response (`data.session_token`)
   *  and store it. No-op if the response carries none (e.g. a legacy shape). */
  captureScan(response: unknown): void {
    const token = (response as { data?: { session_token?: unknown } } | null)?.data?.session_token;
    if (typeof token === 'string' && token.trim()) {
      this.setToken(token);
    }
  }

  /** Drop only the session token (a recoverable TTL lapse); keep the credential
   *  so the next scan re-mints. */
  expireSession(): void {
    this._token.set(null);
    this.storage.removeItem(DinerSessionService.SESSION_KEY);
  }

  /** The QR credential itself is dead — wipe everything and demand a fresh
   *  physical scan. */
  invalidateCredential(): void {
    this._token.set(null);
    this._credential.set(null);
    this.storage.removeItem(DinerSessionService.SESSION_KEY);
    this.storage.removeItem(DinerSessionService.CREDENTIAL_KEY);
    this.needsRescan.set(true);
  }

  /** Full wipe of the diner capability (token + credential + rescan flag). */
  clear(): void {
    this.invalidateCredential();
    this.needsRescan.set(false);
  }

  /**
   * Run `fn` (typically a blanket `sessionStorage.clear()` at checkout) while
   * keeping the diner capability alive across it, so the post-order reset does
   * not strand the follow-up review submission or the back-to-menu re-scan
   * without a session.
   */
  retainSessionThrough(fn: () => void): void {
    const credential = this._credential();
    const token = this._token();
    fn();
    if (credential) this.storage.setItem(DinerSessionService.CREDENTIAL_KEY, credential);
    if (token) this.storage.setItem(DinerSessionService.SESSION_KEY, token);
  }

  /**
   * True when an error is a diner-session TTL/validity failure (recoverable by
   * re-minting from the retained credential). Handles both the raw
   * `HttpErrorResponse` (unit tests / no interceptor) and the `ErrorInterceptor`'s
   * collapsed string form (production), keyed on the backend's fixed messages.
   */
  isSessionExpired(err: unknown): boolean {
    if (typeof err === 'string') {
      return DinerSessionService.SESSION_INVALID_400.has(err.trim());
    }
    const e = err as { status?: number; error?: { message?: string } } | null;
    if (!e) return false;
    const msg = (e.error?.message ?? '').trim();
    return e.status === 400 && DinerSessionService.SESSION_INVALID_400.has(msg);
  }

  /**
   * True when an error is a denied/invalid CREDENTIAL (the QR itself is no
   * longer valid — regenerated or table withdrawn), which needs a fresh
   * physical scan rather than a silent re-mint. Only the capability-denied
   * `Not found.` body counts — a resource miss ("Order not found.") does not.
   */
  isCredentialDenied(err: unknown): boolean {
    if (typeof err === 'string') {
      return err.trim() === DinerSessionService.CAPABILITY_DENIED_404;
    }
    const e = err as { status?: number; error?: { message?: string } } | null;
    if (!e) return false;
    const msg = (e.error?.message ?? '').trim();
    return e.status === 404 && msg === DinerSessionService.CAPABILITY_DENIED_404;
  }

  /** Convenience for callers that only need to know "is this a capability
   *  failure of any kind?". */
  isCapabilityError(err: unknown): boolean {
    return this.isSessionExpired(err) || this.isCredentialDenied(err);
  }
}
