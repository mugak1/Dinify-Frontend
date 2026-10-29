import { AuthenticationService } from '../../_services/authentication.service';
import { SessionActionsService } from '../layout/session-actions.service';
import { AccountComponent } from './account.component';

describe('AccountComponent', () => {
  const make = (roles: string[]) => {
    const auth = {
      logout: jasmine.createSpy('logout'),
      userValue: { profile: { first_name: 'Ada', last_name: 'Okello' } },
      currentRestaurantRole: { restaurant: 'Baba House', roles },
      currentRestaurant: null,
    } as unknown as AuthenticationService;
    const sessionActions = { confirmSignOut: jasmine.createSpy('confirmSignOut') } as unknown as SessionActionsService;
    return { component: new AccountComponent(auth, sessionActions), auth, sessionActions };
  };

  it('Sign out goes through the shared one-confirmation path, never straight to logout', () => {
    const { component, auth, sessionActions } = make(['owner']);
    component.signOut();
    expect(sessionActions.confirmSignOut).toHaveBeenCalledTimes(1);
    expect((auth as any).logout).not.toHaveBeenCalled();
  });

  it('labels the role through the one role vocabulary (roleLabel)', () => {
    expect(make(['kitchen']).component.roleLabel).toBe('Chef');
    expect(make(['restaurant_staff']).component.roleLabel).toBe('Staff');
    expect(make(['owner']).component.roleLabel).toBe('Owner');
  });
});
