import {
  ASSIGNABLE_ROLES,
  DISPLAYABLE_ROLES,
  isAssignableRole,
  isDisplayableRole,
  legacyRoleLabel,
  roleLabel,
} from './staff-roles';

describe('staff-roles', () => {
  it('offers exactly manager/kitchen/restaurant_staff (owner + waiter + finance not assignable)', () => {
    expect([...ASSIGNABLE_ROLES]).toEqual(['manager', 'kitchen', 'restaurant_staff']);
    expect(ASSIGNABLE_ROLES).not.toContain('owner' as never);
    expect(ASSIGNABLE_ROLES).not.toContain('waiter' as never);
    expect(ASSIGNABLE_ROLES).not.toContain('finance' as never);
  });

  it('displays owner plus the three assignable roles', () => {
    expect([...DISPLAYABLE_ROLES]).toEqual([
      'owner',
      'manager',
      'kitchen',
      'restaurant_staff',
    ]);
  });

  it('treats only manager/kitchen/restaurant_staff as assignable', () => {
    expect(isAssignableRole('manager')).toBeTrue();
    expect(isAssignableRole('kitchen')).toBeTrue();
    expect(isAssignableRole('restaurant_staff')).toBeTrue();
    expect(isAssignableRole('owner')).toBeFalse();
    expect(isAssignableRole('waiter')).toBeFalse();
    expect(isAssignableRole('finance')).toBeFalse();
    expect(isAssignableRole('')).toBeFalse();
    expect(isAssignableRole(null)).toBeFalse();
  });

  it('treats owner as displayable (valid) but a retired role as not', () => {
    expect(isDisplayableRole('owner')).toBeTrue();
    expect(isDisplayableRole('restaurant_staff')).toBeTrue();
    expect(isDisplayableRole('finance')).toBeFalse();
    expect(isDisplayableRole('waiter')).toBeFalse();
    expect(isDisplayableRole(null)).toBeFalse();
  });

  it('labels roles via the friendly map, falling back to titlecase for legacy roles', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('manager')).toBe('Manager');
    expect(roleLabel('kitchen')).toBe('Chef');
    expect(roleLabel('restaurant_staff')).toBe('Staff');
    expect(roleLabel('finance')).toBe('Finance'); // titlecase fallback (legacy)
    expect(roleLabel('')).toBe('');
    expect(roleLabel(undefined)).toBe('');
  });

  it('marks a retired role as legacy', () => {
    expect(legacyRoleLabel('finance')).toBe('Finance (legacy)');
    expect(legacyRoleLabel('waiter')).toBe('Waiter (legacy)');
  });
});
