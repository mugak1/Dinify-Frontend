export function getContrastTextColor(hex: string): '#000000' | '#ffffff' {
  if (!hex || typeof hex !== 'string') return '#000000';

  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) {
    value = value
      .split('')
      .map(c => c + c)
      .join('');
  }
  if (value.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(value)) return '#000000';

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 186 ? '#000000' : '#ffffff';
}
