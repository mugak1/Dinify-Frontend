import { ActivatedRouteSnapshot } from '@angular/router';

/**
 * The diner surface renders in three MOUNTS: the standalone diner shell
 * (`/diner/...`), the restaurant portal's ordering preview
 * (`/rest-app-ordering/...`), and the platform-admin embed
 * (`/mgt-app/restaurants/rest-app/:id/rest-app-ordering/...` — which nests the
 * portal module and therefore reuses the same `rest-app-ordering` declaration).
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
 * parents (`diner`, `rest-app-ordering` — both component-bearing,
 * non-empty-path routes) does NOT inherit into child snapshots; do not set the
 * strategy globally just for this. No flag anywhere on the chain defaults to
 * STANDALONE — the safe answer for the QR cold-load path. Pinned by
 * diner-mount.spec.ts across all three mounts via routed activation.
 */
export function resolveDinerMountEmbedded(route: ActivatedRouteSnapshot | null): boolean {
  for (let snapshot = route; snapshot; snapshot = snapshot.parent) {
    if (DINER_MOUNT_EMBEDDED in snapshot.data) {
      return snapshot.data[DINER_MOUNT_EMBEDDED] === true;
    }
  }
  return false;
}
