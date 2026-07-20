import { isEmbeddedDinerMount } from './diner-mount';

/**
 * The diner menu renders in three mounts; everything outside the standalone
 * /diner shell is a back-office embed. Pinned here because the check used to
 * be a `url.includes('rest-app')` substring match that survived the portal's
 * hoist to the URL root only by naming accident.
 */
describe('isEmbeddedDinerMount', () => {
  it('treats the standalone diner shell as NOT embedded', () => {
    expect(isEmbeddedDinerMount('/diner')).toBeFalse();
    expect(isEmbeddedDinerMount('/diner/h/table-1?c=CRED')).toBeFalse();
    expect(isEmbeddedDinerMount('/diner/menu')).toBeFalse();
    expect(isEmbeddedDinerMount('/diner/basket/order-complete')).toBeFalse();
  });

  it('treats the portal ordering preview as embedded', () => {
    expect(isEmbeddedDinerMount('/rest-app-ordering')).toBeTrue();
    expect(isEmbeddedDinerMount('/rest-app-ordering/menu')).toBeTrue();
  });

  it('treats the platform-admin restaurant embed as embedded', () => {
    expect(isEmbeddedDinerMount('/mgt-app/restaurants/rest-app/42/rest-app-ordering')).toBeTrue();
    expect(isEmbeddedDinerMount('/mgt-app/restaurants/rest-app/42/rest-app-ordering/menu')).toBeTrue();
  });

  it('treats a legacy pre-hoist portal URL as embedded (it is never the diner shell)', () => {
    expect(isEmbeddedDinerMount('/rest-app/rest-app-ordering')).toBeTrue();
  });
});
