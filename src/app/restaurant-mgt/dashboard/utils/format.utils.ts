/**
 * Format a number as UGX currency string.
 * @param value  numeric value (number or parseable string)
 * @param showCurrency  prepend "UGX " when true
 * @returns e.g. "1,250,000" or "UGX 1,250,000"
 */
export function formatCurrency(value: number | string, showCurrency = false): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return showCurrency ? 'UGX 0' : '0';
  const formatted = Math.round(num).toLocaleString('en-US');
  return showCurrency ? `UGX ${formatted}` : formatted;
}

/**
 * Format a number in compact notation.
 * @returns e.g. "1.2M", "850K", "1,200"
 */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}${parseFloat(m.toFixed(1))}M`;
  }
  if (abs >= 10_000) {
    const k = abs / 1_000;
    return `${sign}${parseFloat(k.toFixed(1))}K`;
  }
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
}

/**
 * Format a number for chart Y-axis tick labels.
 * @returns e.g. "1.2M", "500K", "200"
 */
export function formatChartTick(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    return `${sign}${parseFloat((abs / 1_000_000).toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${parseFloat((abs / 1_000).toFixed(0))}K`;
  }
  return `${sign}${abs}`;
}
