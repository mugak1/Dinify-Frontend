import { MenuItem } from 'src/app/_models/app.models';

type ImageSource = Pick<MenuItem, 'image'> & { image_thumbnail?: string | null };

/**
 * Path used in compact menu cards and the featured carousel. Prefers the
 * lighter `image_thumbnail` when the backend supplies one; otherwise falls
 * back to the full `image` so menus keep working before the backend rolls
 * out the new field.
 */
export function getMenuItemCardImagePath(item: ImageSource | null | undefined): string | null {
  if (!item) return null;
  return item.image_thumbnail || item.image || null;
}

/**
 * Path used for the detail modal hero. Always the full-resolution `image`.
 */
export function getMenuItemDetailImagePath(item: ImageSource | null | undefined): string | null {
  if (!item) return null;
  return item.image || null;
}

/** Convenience: card image absolute URL, or null when no image is available. */
export function getMenuItemCardImageUrl(
  item: ImageSource | null | undefined,
  baseUrl: string,
): string | null {
  const path = getMenuItemCardImagePath(item);
  return path ? baseUrl + path : null;
}

/** Convenience: detail image absolute URL, or null when no image is available. */
export function getMenuItemDetailImageUrl(
  item: ImageSource | null | undefined,
  baseUrl: string,
): string | null {
  const path = getMenuItemDetailImagePath(item);
  return path ? baseUrl + path : null;
}
