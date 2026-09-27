import { ActivatedRouteSnapshot } from '@angular/router';

/**
 * The diner surface renders in ONE mount today: the standalone diner shell
 * (`/diner/...`). Two others existed and are gone — the platform-admin embed
 * (removed with the admin plane in PR-6) and the restaurant portal's
 * `rest-app-ordering` preview (retired: nothing linked to it, it errored
 * without a prior QR scan, and its staff checkout could never succeed). This
 * flag, the resolver and the menu's `isInRestApp` branches are therefore
 * DORMANT: kept so removing them is its own deliberate cleanup, not folded
 * into the route retirement.
 *
 * Whether a mount is an EMBED is declared ON THE ROUTE via this data key —
 * never inferred from the URL string. `router.url` is unreliable while a
 * navigation is in flight (it still holds the previous tree until the router
 * commits, so guards/resolvers and anything they trigger see the OLD url),
 * whereas an ActivatedRoute snapshot is per-activation state and is correct on
 * a cold load by construction.
 */
export const DINER_MOUNT_EMBEDDED = 'dinerEmbeddedMount';

/**
 * Resolve the mount flag from a component's ActivatedRoute snapshot by walking
 * up the parent chain: the nearest route that declares DINER_MOUNT_EMBEDDED
 * wins. The walk is required because the app keeps the router's default
 * paramsInheritanceStrategy ('emptyOnly'), under which data on the mount
 * parent (`diner`, a component-bearing, non-empty-path route) does NOT
 * inherit into child snapshots; do not set the strategy globally just for
 * this. No flag anywhere on the chain defaults to STANDALONE — the safe answer
 * for the QR cold-load path. Pinned by diner-mount.spec.ts via routed
 * activation of the real `diner` mount and a synthetic embedded one, plus a
 * nested case proving the walk finds the NEAREST declaring ancestor.
 */
export function resolveDinerMountEmbedded(route: ActivatedRouteSnapshot | null): boolean {
  for (let snapshot = route; snapshot; snapshot = snapshot.parent) {
    if (DINER_MOUNT_EMBEDDED in snapshot.data) {
      return snapshot.data[DINER_MOUNT_EMBEDDED] === true;
    }
  }
  return false;
}
