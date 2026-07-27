/**
 * The platform-role gate's matcher, proved to fire (FE-AUTH-00).
 *
 * `scripts/check-platform-roles.mjs` is a Node script rather than a spec, because a
 * source scanner cannot run in this repo's Karma suite: headless Chrome on the esbuild
 * `@angular/build:karma` builder has no `fs`, no `require.context` (webpack-only, and
 * the repo migrated off webpack), no raw-loader and no `preprocessors` hook, and
 * `tsconfig.spec.json` compiles only specs and `.d.ts`. The script carries its own
 * `--self-test`, which is what actually runs in CI.
 *
 * This spec exists for the half a browser CAN prove: that the ROUTE CONFIG the gate is
 * protecting really is clean, read from the live `routes` export rather than from source
 * text. It is the object-graph counterpart to the script's text scan, and it sits in
 * `_security/` so `test:tenant-boundary`'s existing `src/app/_security/**\/*.spec.ts`
 * include picks it up with no package.json change.
 *
 * This file is on the script's `SELF_EXEMPT` list — it has to spell the retired literals
 * in order to assert their absence.
 */
import { Route } from '@angular/router';

import { routes } from '../app-routing.module';

const PLATFORM_ROLE_LITERALS = ['dinify_admin', 'dinify_account_manager'];

/** Every route in the tree, flattened — `children` included. */
function flatten(list: Route[]): Route[] {
  return list.flatMap((route) => [route, ...flatten(route.children ?? [])]);
}

describe('Platform-role ratchet — route config', () => {
  const all = flatten(routes);

  it('declares no platform-role literal in any route data', () => {
    const offenders = all
      .map((route) => ({
        path: route.path ?? '(empty)',
        roles: (route.data?.['roles'] ?? []) as string[],
      }))
      .filter(({ roles }) => roles.some((r) => PLATFORM_ROLE_LITERALS.includes(r)));

    expect(offenders).toEqual([]);
  });

  it('gates /kitchen on restaurant roles alone, with no data.roles at all', () => {
    const kitchen = all.find((route) => route.path === 'kitchen');
    expect(kitchen).toBeTruthy();

    // No data.roles: the platform-role entry that used to sit here is gone, and
    // nothing replaced it. AuthGuard's `if (roles || restaurant_roles)` still fires
    // on the truthy restaurant_roles array, so the route stays gated.
    expect(kitchen!.data?.['roles']).toBeUndefined();
    expect(kitchen!.data?.['restaurant_roles']).toEqual(['owner', 'manager', 'kitchen']);
    expect(kitchen!.canActivate?.length).toBe(1);
  });

  it('keeps the portal parent gated on restaurant_staff', () => {
    // Unchanged by this work, and asserted here so a sweep that removes data.roles
    // wholesale cannot quietly ungate the portal shell: `restaurant_staff` is a
    // RESTAURANT role and it is what AuthGuard's membership bridge keys on.
    const portal = all.find(
      (route) => route.path === '' && route.data?.['roles'] !== undefined,
    );
    expect(portal?.data?.['roles']).toEqual(['restaurant_staff']);
  });
});
