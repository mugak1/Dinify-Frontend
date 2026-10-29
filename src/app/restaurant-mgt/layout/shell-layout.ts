/**
 * THE ONE SOURCE of the portal shell's width boundaries (SHELL-FINISH-00, PR 1).
 *
 * The shell has three regimes, and every sidebar/top-bar decision about width is
 * derived from `regimeForWidth` — no template carries a `lg:`/`xl:` class for the
 * sidebar boundary, and styles.css no longer carries a media query for it.
 *
 *   below 1024      'drawer'        an overlay drawer; nothing in flow; the menu
 *                                   button in the top bar opens it.
 *   1024 – 1279     'rail-overlay'  the 64px icon rail sits in flow; expanding it
 *                                   opens the full sidebar OVER the content, never
 *                                   pushing it.
 *   1280 and above  'rail-push'     the rail sits in flow, expanded (220px) or
 *                                   collapsed (64px) by the saved preference.
 *
 * WHY 1280 STILL MATTERS. On 24 June the owner reported that an iPad Pro in
 * portrait — exactly 1024px — got the 220px rail in flow, pushing the content.
 * So 1024–1279 gets the rail but never a pushing expansion. The overlay
 * expansion is what keeps the labels reachable on a touch tablet there: the
 * collapsed rail's labels come from a tooltip that responds only to a mouse.
 *
 * Everything else in the app that says `lg:` or `xl:` is page layout and is
 * deliberately untouched.
 */
export const RAIL_MIN_PX = 1024;
export const PUSH_MIN_PX = 1280;

export type ShellRegime = 'drawer' | 'rail-overlay' | 'rail-push';

export const RAIL_WIDTH_PX = 64;
export const EXPANDED_WIDTH_PX = 220;

export function regimeForWidth(width: number): ShellRegime {
  if (width >= PUSH_MIN_PX) return 'rail-push';
  if (width >= RAIL_MIN_PX) return 'rail-overlay';
  return 'drawer';
}
