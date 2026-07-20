import { inject } from '@angular/core';
import { RedirectFunction, Router } from '@angular/router';

/**
 * Redirect handler for legacy `/rest-app/...` URLs from before the restaurant
 * portal was hoisted to the URL root — old bookmarks, browser history and any
 * link minted pre-hoist keep working.
 *
 * Behaviour contract (pinned by app-routing.module.spec.ts):
 *  - `/rest-app`            -> `/dashboard`. Bare `/rest-app` used to resolve
 *    via the portal's internal `'' -> dashboard` redirect, so it maps to
 *    `/dashboard` specifically — deliberately NOT firstAccessibleRoute();
 *    this preserves the pre-hoist behaviour rather than improving on it.
 *  - `/rest-app/<rest>`     -> `/<rest>` — only the leading `rest-app`
 *    segment is stripped, with query params and fragment preserved.
 *
 * The redirect resolves inside the same navigation, so the browser gets a
 * single history entry holding the final URL — the back button never bounces
 * off `/rest-app`. A `rest-app` segment that is not the FIRST primary segment
 * (e.g. the admin embed `/mgt-app/restaurants/rest-app/:id/...`) is claimed by
 * an earlier named route and never reaches this handler.
 */
export const redirectLegacyRestAppUrl: RedirectFunction = ({ url, queryParams, fragment }) => {
  const segments = url.length ? url.map((segment) => segment.path) : ['dashboard'];
  return inject(Router).createUrlTree(['/', ...segments], {
    queryParams,
    fragment: fragment ?? undefined,
  });
};
