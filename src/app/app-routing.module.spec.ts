import { Component, Type, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { SpyLocation, provideLocationMocks } from '@angular/common/testing';
import { provideRouter, Route, Router, RouterOutlet, Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from './app-routing.module';

/**
 * Pins the two invariants the portal hoist introduced:
 *
 * 1. ROUTE-ORDERING RATCHET — the restaurant portal lives at the URL root as an
 *    empty-path parent whose lazy children end in a `**` wildcard, so it
 *    prefix-matches EVERYTHING that reaches it. Any route declared below it is
 *    unreachable (swallowed by the portal). The static assertions here fail the
 *    moment someone appends a new root-level route after the portal parent —
 *    that route must be declared ABOVE it instead.
 *
 * 2. LEGACY /rest-app REDIRECTS — pre-hoist bookmarks/history must keep
 *    working: only a LEADING `rest-app` segment is stripped (bare `/rest-app`
 *    maps to `/dashboard` specifically, mirroring the old ''→dashboard
 *    redirect), query params + fragment survive, and the browser history holds
 *    a single entry with the final URL (no `/rest-app` bounce entry).
 *
 * The navigation tests run against a STUBBED copy of the real `routes` array:
 * paths, ordering and redirect functions are the real ones; components are
 * replaced with empty stubs, guards are dropped, and each lazy parent's
 * children become stub leaves ending in `**` — faithfully mirroring the
 * portal's swallow-everything wildcard without pulling in real modules.
 */

@Component({ changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
class NamedStubComponent {}

@Component({ template: '<router-outlet />', changeDetection: ChangeDetectionStrategy.Eager,
 imports: [RouterOutlet] })
class ShellStubComponent {}

@Component({ changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
class PortalLeafStubComponent {}

@Component({ changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
class DinerLeafStubComponent {}

@Component({ changeDetection: ChangeDetectionStrategy.Eager,
 template: '' })
class KitchenLeafStubComponent {}

const LAZY_LEAF_STUBS: Record<string, Type<unknown>> = {
  '': PortalLeafStubComponent,
  'diner': DinerLeafStubComponent,
  'kitchen': KitchenLeafStubComponent,
};

function stubRoutes(): Routes {
  return routes.map((route) => {
    const copy: Route = { ...route };
    delete copy.canActivate;
    if (copy.loadComponent) {
      delete copy.loadComponent;
      copy.component = NamedStubComponent;
    } else if (copy.component) {
      copy.component = copy.loadChildren ? ShellStubComponent : NamedStubComponent;
    }
    if (copy.loadChildren) {
      const leaf = LAZY_LEAF_STUBS[route.path ?? ''] ?? NamedStubComponent;
      delete copy.loadChildren;
      copy.children = [
        { path: '', pathMatch: 'full', component: leaf },
        { path: '**', component: leaf },
      ];
    }
    return copy;
  });
}

describe('app routes — ordering ratchet (static, real config)', () => {
  const portalIndex = routes.findIndex((r) => r.path === '' && !!r.loadChildren);
  const wildcardIndex = routes.findIndex((r) => r.path === '**');

  it('keeps the portal parent second-to-last and the wildcard last', () => {
    expect(portalIndex).toBeGreaterThan(-1);
    expect(wildcardIndex).toBe(routes.length - 1);
    expect(portalIndex).toBe(routes.length - 2);
  });

  it('declares NOTHING below the portal parent except the final wildcard (a route added below it would be swallowed)', () => {
    routes.forEach((route, index) => {
      if (index > portalIndex) {
        expect(route.path)
          .withContext(`route '${route.path}' is declared below the root portal parent and can never match — move it above`)
          .toBe('**');
      }
    });
  });

  it('declares every named root route (and the legacy rest-app redirect) above the portal parent', () => {
    const named = ['login', 'register', 'forgot-password', 'welcome', 'owner-claim',
      'diner', 'kitchen', 'lock-otp-exp', 'privacy', 'terms', 'cookies', 'rest-app'];
    for (const path of named) {
      const index = routes.findIndex((r) => r.path === path);
      expect(index).withContext(`route '${path}' is missing`).toBeGreaterThan(-1);
      expect(index).withContext(`route '${path}' must sit above the portal parent`).toBeLessThan(portalIndex);
    }
  });

  it('keeps /owner-claim public — neither AuthGuard nor loginRedirectGuard', () => {
    // The claimant has no session (that is the point of the flow), and an
    // already-signed-in operator claiming a SECOND restaurant must reach the form
    // rather than be redirected to their existing landing. Either guard would break
    // one of those two cases, so the route must carry neither.
    const claim = routes.find((r) => r.path === 'owner-claim');
    expect(claim).toBeTruthy();
    expect(claim?.canActivate).toBeUndefined();
    expect(claim?.canActivateChild).toBeUndefined();
    expect(claim?.data?.['roles']).toBeUndefined();
    expect(claim?.data?.['restaurant_roles']).toBeUndefined();
    expect(claim?.loadComponent).toBeTruthy();
  });

  it('keeps the AuthGuard + restaurant_staff role data on the hoisted portal parent', () => {
    const portal = routes[portalIndex];
    expect(portal.loadChildren).toBeTruthy();
    expect(portal.canActivate?.length).toBe(1);
    expect(portal.data?.['roles']).toEqual(['restaurant_staff']);
  });
});

describe('app routes — navigation behaviour (stubbed components, real paths/order/redirects)', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter(stubRoutes()), provideLocationMocks()],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  function topRoutePath(): string | undefined {
    return router.routerState.snapshot.root.firstChild?.routeConfig?.path;
  }

  function deepestComponent(): Type<unknown> | null {
    let snapshot = router.routerState.snapshot.root;
    while (snapshot.firstChild) snapshot = snapshot.firstChild;
    return (snapshot.component as Type<unknown> | null) ?? null;
  }

  describe('named root routes resolve to their own route, never into the portal', () => {
    for (const path of ['login', 'register', 'forgot-password', 'welcome', 'owner-claim', 'lock-otp-exp', 'privacy', 'terms', 'cookies']) {
      it(`resolves /${path} at its own route`, async () => {
        await harness.navigateByUrl(`/${path}`);
        expect(router.url).toBe(`/${path}`);
        expect(topRoutePath()).toBe(path);
        expect(deepestComponent()).toBe(NamedStubComponent);
      });
    }

    it('resolves /diner inside the diner shell, not the portal', async () => {
      await harness.navigateByUrl('/diner');
      expect(topRoutePath()).toBe('diner');
      expect(deepestComponent()).toBe(DinerLeafStubComponent);
    });

    it('resolves /kitchen on the kitchen board, not the portal', async () => {
      await harness.navigateByUrl('/kitchen');
      expect(topRoutePath()).toBe('kitchen');
      expect(deepestComponent()).toBe(KitchenLeafStubComponent);
    });

    it('redirects the bare root to /login (exact-match redirect above the portal parent)', async () => {
      await harness.navigateByUrl('/');
      expect(router.url).toBe('/login');
      expect(topRoutePath()).toBe('login');
    });

    it('sends an unknown URL into the portal (mirrors the old /rest-app/<unknown> behaviour)', async () => {
      await harness.navigateByUrl('/no-such-surface');
      expect(topRoutePath()).toBe('');
      expect(deepestComponent()).toBe(PortalLeafStubComponent);
    });
  });

  describe('legacy /rest-app redirects', () => {
    it('maps bare /rest-app to /dashboard specifically (the old ""→dashboard bounce, not firstAccessibleRoute)', async () => {
      await harness.navigateByUrl('/rest-app');
      expect(router.url).toBe('/dashboard');
      expect(deepestComponent()).toBe(PortalLeafStubComponent);
    });

    it('keeps query params on the bare redirect', async () => {
      await harness.navigateByUrl('/rest-app?welcome=1');
      expect(router.url).toBe('/dashboard?welcome=1');
    });

    it('maps /rest-app/dashboard to /dashboard', async () => {
      await harness.navigateByUrl('/rest-app/dashboard');
      expect(router.url).toBe('/dashboard');
    });

    it('preserves query params on deep links (/rest-app/reviews/feed?review=X)', async () => {
      await harness.navigateByUrl('/rest-app/reviews/feed?review=X');
      expect(router.url).toBe('/reviews/feed?review=X');
    });

    it('maps nested paths (/rest-app/settings/team/roles)', async () => {
      await harness.navigateByUrl('/rest-app/settings/team/roles');
      expect(router.url).toBe('/settings/team/roles');
    });

    it('strips ONLY the leading segment (/rest-app/rest-app-ordering keeps its own rest-app-ordering)', async () => {
      await harness.navigateByUrl('/rest-app/rest-app-ordering');
      expect(router.url).toBe('/rest-app-ordering');
      expect(deepestComponent()).toBe(PortalLeafStubComponent);
    });

    it('preserves the fragment (/rest-app/menu#todays-specials)', async () => {
      await harness.navigateByUrl('/rest-app/menu#todays-specials');
      expect(router.url).toBe('/menu#todays-specials');
    });

    it('strips ONLY the leading segment when a second rest-app sits deeper in the same URL', async () => {
      // This one genuinely runs the handler: the router has already consumed the
      // leading `rest-app`, so redirectLegacyRestAppUrl receives
      // ['menu','rest-app','42'] and must rebuild them verbatim. A "drop every
      // rest-app segment" regression would land on /menu/42 instead.
      await harness.navigateByUrl('/rest-app/menu/rest-app/42');
      expect(router.url).toBe('/menu/rest-app/42');
      expect(deepestComponent()).toBe(PortalLeafStubComponent);
    });

    // A literal `rest-app` segment in a NON-first position must never reach
    // redirectLegacyRestAppUrl — an earlier named route claims the URL first.
    // (The sibling case above covers `rest-app-ordering`, a different string,
    // so it does not substitute for this one.) The carrier was the admin embed
    // until PR-6 removed it; `/diner` serves identically — a named route
    // declared above `rest-app` whose subtree swallows the rest.
    it('never touches a mid-URL rest-app segment (an earlier named route claims it)', async () => {
      await harness.navigateByUrl('/diner/rest-app/42/menu');
      expect(router.url).toBe('/diner/rest-app/42/menu');
      expect(topRoutePath()).toBe('diner');
      expect(deepestComponent()).toBe(DinerLeafStubComponent);
    });

    it('resolves the redirect inside one navigation — no /rest-app entry ever reaches the history log', async () => {
      const location = TestBed.inject(Location) as SpyLocation;
      await harness.navigateByUrl('/rest-app/dashboard');
      expect(location.path()).toBe('/dashboard');
      expect(location.urlChanges.filter((change) => change.includes('rest-app')))
        .withContext('a /rest-app URL was written to history — the back button would bounce')
        .toEqual([]);
    });
  });
});
