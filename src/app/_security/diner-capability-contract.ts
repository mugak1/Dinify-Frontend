/**
 * Frontend-owned contract for the anonymous-diner capability channel (backend PR 7A).
 *
 * Single source of truth for:
 *  - the capability header NAMES the backend accepts;
 *  - the EXACT first-party route allowlist (method + version-pinned pathname);
 *  - the pure `classifyDinerCapabilityRequest` classifier the `DinerSessionInterceptor`
 *    uses to decide which — if any — capability a request is permitted to carry.
 *
 * The interceptor and every focused/closure spec import from here, so the route and
 * header constants can never drift into parallel copies. This is deliberately NOT a
 * generic authorization framework — it is the one narrow diner-capability contract.
 *
 * The backend asserts the identical route/header contract (its ContractParityClosureTests);
 * `tenant-isolation-closure.spec.ts` §14 pins these values so a cross-repo drift fails a gate.
 */

/** The QR credential rides this header on the table-scan exchange only. */
export const CREDENTIAL_HEADER = 'X-Diner-Credential';
/** The minted table session rides this header on downstream diner calls only. */
export const SESSION_HEADER = 'X-Diner-Session';

/** Which capability a request is allowed to carry. `null` = neither (fail closed). */
export type DinerCapability = 'credential' | 'session';

export interface DinerRoute {
  readonly method: 'GET' | 'POST' | 'PUT';
  /**
   * The EXACT request pathname relative to the configured API base (origin + any base
   * prefix such as `/uat`). Version-pinned and trailing-slash-exact, matching the app's
   * `ApiService` URL convention (`${apiUrl}/api/<version>/<path>`).
   */
  readonly path: string;
  readonly capability: DinerCapability;
}

/** The ONLY route that receives the QR credential. */
export const CREDENTIAL_ROUTE: DinerRoute = {
  method: 'GET',
  path: '/api/v1/orders/journey/table-scan/',
  capability: 'credential',
};

/** The ONLY routes that receive the minted table session. */
export const SESSION_ROUTES: readonly DinerRoute[] = [
  { method: 'GET', path: '/api/v1/orders/journey/order-details/', capability: 'session' },
  { method: 'GET', path: '/api/v1/orders/journey/payment-details/', capability: 'session' },
  { method: 'POST', path: '/api/v2/orders/initiate/', capability: 'session' },
  { method: 'PUT', path: '/api/v1/orders/submit/', capability: 'session' },
  { method: 'POST', path: '/api/v1/reviews/submit/', capability: 'session' },
];

/**
 * The public, session-free menu. Listed explicitly so it is documented as receiving
 * NEITHER capability header — it is a restaurant-id-filtered public read governed by the
 * backend's canonical publication policy, not the diner session.
 */
export const PUBLIC_MENU_ROUTE: { readonly method: 'GET'; readonly path: string } = {
  method: 'GET',
  path: '/api/v1/orders/journey/show-menu/',
};

/** Every route that may carry a capability — the credential route plus the session set. */
const CAPABILITY_ROUTES: readonly DinerRoute[] = [CREDENTIAL_ROUTE, ...SESSION_ROUTES];

/**
 * Classify a request against the exact first-party diner-capability allowlist.
 *
 * Returns the capability the request is permitted to carry (`'credential'` or `'session'`),
 * or `null` when it must carry neither. It FAILS CLOSED at every step:
 *  - the URL (or the API base) cannot be parsed — relative, protocol-relative or malformed;
 *  - the request origin (scheme + host + port) differs from the configured API origin;
 *  - the request pathname does not sit under the configured API base prefix (e.g. `/uat`);
 *  - the HTTP method does not match the route's method;
 *  - the pathname is not EXACTLY one of the allowlisted routes (a similar-but-not-exact
 *    path, an extra segment, an embedded external URL, or the public `show-menu` route).
 *
 * Because classification is done on the parsed `URL.pathname`, query parameters never
 * affect it, and a route string embedded only in a query parameter can never match. No
 * production hostname is hardcoded — the origin and base prefix come entirely from
 * `apiBase` (the caller passes `environment.apiUrl`), so dev/prod bare-origin shapes and
 * the uat/staging path-prefixed shapes are all handled without an environment variable.
 *
 * @param method  the request HTTP method (case-insensitive)
 * @param url     the absolute request URL
 * @param apiBase the configured API base — `environment.apiUrl` (origin + optional prefix)
 */
export function classifyDinerCapabilityRequest(
  method: string,
  url: string,
  apiBase: string,
): DinerCapability | null {
  let base: URL;
  let target: URL;
  try {
    base = new URL(apiBase);
    // Parsed without a base, so a relative or protocol-relative URL throws → fail closed.
    target = new URL(url);
  } catch {
    return null;
  }

  // First-party origin (scheme + host + port) is mandatory.
  if (target.origin !== base.origin) {
    return null;
  }

  // Normalise the base prefix (`''` for a bare origin, `/uat` | `/staging` otherwise) and
  // require the request to sit strictly under it, then classify on the remainder only.
  const basePath = base.pathname.replace(/\/+$/, '');
  let relativePath: string;
  if (basePath === '') {
    relativePath = target.pathname;
  } else if (target.pathname.startsWith(basePath + '/')) {
    relativePath = target.pathname.slice(basePath.length);
  } else {
    return null;
  }

  const upperMethod = method.toUpperCase();
  for (const route of CAPABILITY_ROUTES) {
    if (route.method === upperMethod && route.path === relativePath) {
      return route.capability;
    }
  }
  return null;
}
