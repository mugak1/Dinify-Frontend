import {
  getMenuItemCardImagePath,
  getMenuItemCardImageUrl,
  getMenuItemDetailImagePath,
  getMenuItemDetailImageUrl,
} from './image-utils';

describe('image-utils', () => {
  const baseUrl = 'https://api.example.com';

  describe('getMenuItemCardImagePath', () => {
    it('returns image_thumbnail when present', () => {
      expect(
        getMenuItemCardImagePath({ image: '/full.jpg', image_thumbnail: '/thumb.jpg' } as any),
      ).toBe('/thumb.jpg');
    });

    it('falls back to image when image_thumbnail is missing', () => {
      expect(getMenuItemCardImagePath({ image: '/full.jpg' } as any)).toBe('/full.jpg');
    });

    it('falls back to image when image_thumbnail is null', () => {
      expect(
        getMenuItemCardImagePath({ image: '/full.jpg', image_thumbnail: null } as any),
      ).toBe('/full.jpg');
    });

    it('falls back to image when image_thumbnail is empty', () => {
      expect(
        getMenuItemCardImagePath({ image: '/full.jpg', image_thumbnail: '' } as any),
      ).toBe('/full.jpg');
    });

    it('returns null when neither image is present', () => {
      expect(getMenuItemCardImagePath({ image: null } as any)).toBeNull();
    });

    it('returns null for nullish item', () => {
      expect(getMenuItemCardImagePath(null)).toBeNull();
      expect(getMenuItemCardImagePath(undefined)).toBeNull();
    });
  });

  describe('getMenuItemDetailImagePath', () => {
    it('returns image regardless of image_thumbnail', () => {
      expect(
        getMenuItemDetailImagePath({ image: '/full.jpg', image_thumbnail: '/thumb.jpg' } as any),
      ).toBe('/full.jpg');
    });

    it('returns null when image is null', () => {
      expect(
        getMenuItemDetailImagePath({ image: null, image_thumbnail: '/thumb.jpg' } as any),
      ).toBeNull();
    });

    it('returns null for nullish item', () => {
      expect(getMenuItemDetailImagePath(null)).toBeNull();
    });
  });

  describe('absolute URL helpers', () => {
    it('prefixes the card path with the base URL', () => {
      expect(
        getMenuItemCardImageUrl({ image: '/full.jpg', image_thumbnail: '/thumb.jpg' } as any, baseUrl),
      ).toBe('https://api.example.com/thumb.jpg');
    });

    it('returns null from getMenuItemCardImageUrl when no image is available', () => {
      expect(getMenuItemCardImageUrl({ image: null } as any, baseUrl)).toBeNull();
    });

    it('prefixes the detail path with the base URL', () => {
      expect(
        getMenuItemDetailImageUrl({ image: '/full.jpg', image_thumbnail: '/thumb.jpg' } as any, baseUrl),
      ).toBe('https://api.example.com/full.jpg');
    });

    it('returns null from getMenuItemDetailImageUrl when no image is available', () => {
      expect(getMenuItemDetailImageUrl({ image: null } as any, baseUrl)).toBeNull();
    });
  });
});
