/**
 * Whether the diner menu surface is rendered inside a back-office EMBED — the
 * restaurant portal's ordering preview (`/rest-app-ordering/...`) or the
 * platform-admin embed (`/mgt-app/restaurants/rest-app/:id/...`) — rather than
 * the standalone diner shell. Every standalone diner URL starts with `/diner`
 * (the diner app's root route), so any other mount is an embed.
 *
 * This replaced a `url.includes('rest-app')` substring match, which kept
 * working only by naming accident once the portal was hoisted from
 * `/rest-app/*` to the URL root. Pinned by diner-mount.spec.ts across all
 * three mounts.
 */
export function isEmbeddedDinerMount(url: string): boolean {
  return !url.startsWith('/diner');
}
