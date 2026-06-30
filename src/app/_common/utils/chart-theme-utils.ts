/**
 * Canvas-safe color resolution for Chart.js (ng2-charts).
 * Chart.js draws on <canvas>, where CSS var(--token) is NOT resolved. Resolve
 * tokens to concrete hsl() strings here, reading from an element inside the
 * themed subtree so custom-property inheritance respects `.dark` if a theme
 * toggle is ever added. Light-theme fallbacks guarantee a token can never
 * fall back to canvas-default black.
 */
export function resolveHsl(el: HTMLElement, token: string, fallback: string): string {
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  return raw ? `hsl(${raw})` : fallback;
}

export interface ChartTooltipTheme {
  backgroundColor: string;
  titleColor: string;
  bodyColor: string;
  borderColor: string;
}

/** The tooltip color block shared by the dashboard/report/review canvas charts. */
export function chartTooltipTheme(el: HTMLElement): ChartTooltipTheme {
  return {
    backgroundColor: resolveHsl(el, '--popover', 'hsl(0 0% 100%)'),
    titleColor: resolveHsl(el, '--foreground', 'hsl(0 0% 9%)'),
    bodyColor: resolveHsl(el, '--muted-foreground', 'hsl(0 0% 38%)'),
    borderColor: resolveHsl(el, '--border', 'hsl(0 0% 90%)'),
  };
}

/** Axis-tick / muted label color, canvas-safe. */
export function chartMutedColor(el: HTMLElement): string {
  return resolveHsl(el, '--muted-foreground', 'hsl(0 0% 38%)');
}

/** Resolve any var(--token) occurrences inside an arbitrary color string. */
export function resolveColorString(el: HTMLElement, value: string): string {
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)/g, (match, token) => {
    return getComputedStyle(el).getPropertyValue(token).trim() || match;
  });
}
