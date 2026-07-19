/**
 * Focused unit spec for the pure diner-capability request classifier.
 *
 * No HTTP machinery — it exercises `classifyDinerCapabilityRequest` directly so the
 * origin / base-prefix / method / exact-route matrix (including the uat `/uat`-prefixed
 * `environment.apiUrl` shape, which the Karma build's dev environment can't otherwise
 * reach) is proven in one place. The interceptor spec then proves the header WIRING on
 * top of it, and the tenant-isolation closure gate proves channel separation end-to-end.
 *
 * Lives under `src/app/_security/`, so the `test:tenant-boundary` glob
 * (`src/app/_security/**\/*.spec.ts`) includes it automatically.
 */
import {
  CREDENTIAL_HEADER,
  SESSION_HEADER,
  CREDENTIAL_ROUTE,
  SESSION_ROUTES,
  PUBLIC_MENU_ROUTE,
  classifyDinerCapabilityRequest,
} from './diner-capability-contract';

// Bare-origin base (dev/prod shape) and path-prefixed base (uat/staging shape).
const DEV_BASE = 'https://api-dev.dinifyapp.com';
const UAT_BASE = 'https://api-test.dinifyapp.com/uat';

/** Build an absolute first-party URL for `path` under `base` (base has no trailing slash). */
function url(base: string, path: string): string {
  return `${base}${path}`;
}

describe('classifyDinerCapabilityRequest', () => {
  describe('contract constants', () => {
    it('pins the capability header names', () => {
      expect(CREDENTIAL_HEADER).toBe('X-Diner-Credential');
      expect(SESSION_HEADER).toBe('X-Diner-Session');
    });

    it('pins the exact credential route (GET table-scan)', () => {
      expect(CREDENTIAL_ROUTE.method).toBe('GET');
      expect(CREDENTIAL_ROUTE.path).toBe('/api/v1/orders/journey/table-scan/');
      expect(CREDENTIAL_ROUTE.capability).toBe('credential');
    });

    it('pins exactly the five session-gated routes', () => {
      expect(SESSION_ROUTES.map(r => `${r.method} ${r.path}`)).toEqual([
        'GET /api/v1/orders/journey/order-details/',
        'GET /api/v1/orders/journey/payment-details/',
        'POST /api/v2/orders/initiate/',
        'PUT /api/v1/orders/submit/',
        'POST /api/v1/reviews/submit/',
      ]);
      expect(SESSION_ROUTES.every(r => r.capability === 'session')).toBeTrue();
    });

    it('pins the public menu route (documented as neither)', () => {
      expect(PUBLIC_MENU_ROUTE.method).toBe('GET');
      expect(PUBLIC_MENU_ROUTE.path).toBe('/api/v1/orders/journey/show-menu/');
    });
  });

  describe('first-party allowlist (bare-origin base)', () => {
    it('classifies GET table-scan as the credential route', () => {
      expect(
        classifyDinerCapabilityRequest('GET', url(DEV_BASE, CREDENTIAL_ROUTE.path), DEV_BASE),
      ).toBe('credential');
    });

    for (const route of SESSION_ROUTES) {
      it(`classifies ${route.method} ${route.path} as a session route`, () => {
        expect(
          classifyDinerCapabilityRequest(route.method, url(DEV_BASE, route.path), DEV_BASE),
        ).toBe('session');
      });
    }
  });

  describe('public menu is explicitly excluded', () => {
    it('classifies GET show-menu as neither capability', () => {
      expect(
        classifyDinerCapabilityRequest('GET', url(DEV_BASE, PUBLIC_MENU_ROUTE.path), DEV_BASE),
      ).toBeNull();
    });

    it('excludes show-menu even with a restaurant query param', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          `${url(DEV_BASE, PUBLIC_MENU_ROUTE.path)}?restaurant=r1`,
          DEV_BASE,
        ),
      ).toBeNull();
    });
  });

  describe('unknown / wrong-method routes fail closed', () => {
    it('rejects an unknown orders/journey/* route', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          url(DEV_BASE, '/api/v1/orders/journey/some-future-endpoint/'),
          DEV_BASE,
        ),
      ).toBeNull();
    });

    it('rejects a known route with the wrong HTTP method (POST table-scan)', () => {
      expect(
        classifyDinerCapabilityRequest('POST', url(DEV_BASE, CREDENTIAL_ROUTE.path), DEV_BASE),
      ).toBeNull();
    });

    it('rejects a known route with the wrong HTTP method (GET initiate)', () => {
      expect(
        classifyDinerCapabilityRequest('GET', url(DEV_BASE, '/api/v2/orders/initiate/'), DEV_BASE),
      ).toBeNull();
    });

    it('rejects the right route on the wrong API version (v2 table-scan / v2 submit)', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          url(DEV_BASE, '/api/v2/orders/journey/table-scan/'),
          DEV_BASE,
        ),
      ).toBeNull();
      expect(
        classifyDinerCapabilityRequest('PUT', url(DEV_BASE, '/api/v2/orders/submit/'), DEV_BASE),
      ).toBeNull();
    });
  });

  describe('query parameters never affect classification', () => {
    it('classifies a session route unchanged when it carries a query string', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          url(DEV_BASE, '/api/v1/orders/journey/payment-details/') + '?transaction=t1',
          DEV_BASE,
        ),
      ).toBe('session');
    });

    it('does not classify off a route string embedded only in a query parameter', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          url(DEV_BASE, '/api/v1/health/') + '?next=/api/v2/orders/initiate/',
          DEV_BASE,
        ),
      ).toBeNull();
    });
  });

  describe('similar-but-not-exact pathnames fail closed', () => {
    const cases = [
      '/api/v2/orders/initiate/extra/',
      '/api/v2/orders/initiate-malicious/',
      '/proxy/https://api.dinifyapp.com/api/v2/orders/initiate/',
      '/api/v1/orders/journey/table-scan', // missing trailing slash
    ];
    for (const path of cases) {
      it(`rejects ${path}`, () => {
        expect(classifyDinerCapabilityRequest('POST', url(DEV_BASE, path), DEV_BASE)).toBeNull();
        expect(classifyDinerCapabilityRequest('GET', url(DEV_BASE, path), DEV_BASE)).toBeNull();
      });
    }
  });

  describe('foreign / malformed destinations fail closed', () => {
    it('rejects an external origin that contains the exact scan path', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          `https://evil.example.com${CREDENTIAL_ROUTE.path}`,
          DEV_BASE,
        ),
      ).toBeNull();
    });

    it('rejects an external origin that contains the exact initiate path', () => {
      expect(
        classifyDinerCapabilityRequest(
          'POST',
          'https://evil.example.com/api/v2/orders/initiate/',
          DEV_BASE,
        ),
      ).toBeNull();
    });

    it('rejects a protocol-relative external URL', () => {
      expect(
        classifyDinerCapabilityRequest('POST', '//evil.example.com/api/v2/orders/initiate/', DEV_BASE),
      ).toBeNull();
    });

    it('rejects a same-host-name but wrong-scheme/port origin', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          `http://api-dev.dinifyapp.com:8080${CREDENTIAL_ROUTE.path}`,
          DEV_BASE,
        ),
      ).toBeNull();
    });

    it('rejects a relative URL (no origin to prove)', () => {
      expect(
        classifyDinerCapabilityRequest('GET', CREDENTIAL_ROUTE.path, DEV_BASE),
      ).toBeNull();
    });

    it('rejects when the API base itself is unparseable', () => {
      expect(
        classifyDinerCapabilityRequest('GET', url(DEV_BASE, CREDENTIAL_ROUTE.path), 'not a url'),
      ).toBeNull();
    });
  });

  describe('base-path prefix (uat/staging shape) is enforced', () => {
    it('classifies a route under the /uat base prefix', () => {
      expect(
        classifyDinerCapabilityRequest('GET', url(UAT_BASE, CREDENTIAL_ROUTE.path), UAT_BASE),
      ).toBe('credential');
      expect(
        classifyDinerCapabilityRequest('POST', url(UAT_BASE, '/api/v2/orders/initiate/'), UAT_BASE),
      ).toBe('session');
    });

    it('rejects a request missing the /uat base prefix even on the right origin', () => {
      // Same host, correct route, but the request omits the configured `/uat` prefix.
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          `https://api-test.dinifyapp.com${CREDENTIAL_ROUTE.path}`,
          UAT_BASE,
        ),
      ).toBeNull();
    });

    it('rejects a sibling prefix on the shared host (/staging vs /uat)', () => {
      // uat and staging share `api-test.dinifyapp.com`; the prefix must still match exactly.
      expect(
        classifyDinerCapabilityRequest(
          'POST',
          `https://api-test.dinifyapp.com/staging/api/v2/orders/initiate/`,
          UAT_BASE,
        ),
      ).toBeNull();
    });

    it('does not treat a look-alike prefix (/uatX) as the /uat base', () => {
      expect(
        classifyDinerCapabilityRequest(
          'GET',
          `https://api-test.dinifyapp.com/uatX${CREDENTIAL_ROUTE.path}`,
          UAT_BASE,
        ),
      ).toBeNull();
    });
  });

  describe('method matching is case-insensitive on the verb only', () => {
    it('accepts a lowercase method for a matching route', () => {
      expect(
        classifyDinerCapabilityRequest('get', url(DEV_BASE, CREDENTIAL_ROUTE.path), DEV_BASE),
      ).toBe('credential');
    });
  });
});
