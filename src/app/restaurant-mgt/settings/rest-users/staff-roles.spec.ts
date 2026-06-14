import {
  ASSIGNABLE_ROLES,
  isAssignableRole,
  legacyRoleLabel,
  roleLabel,
} from './staff-roles';

describe('staff-roles', () => {
  it('offers exactly owner/manager/kitchen/waiter (finance dropped)', () => {
    expect([...ASSIGNABLE_ROLES]).toEqual(['owner', 'manager', 'kitchen', 'waiter']);
    expect(ASSIGNABLE_ROLES).not.toContain('finance' as never);
  });

  it('treats finance as no longer assignable but the four roles as assignable', () => {
    expect(isAssignableRole('owner')).toBeTrue();
    expect(isAssignableRole('waiter')).toBeTrue();
    expect(isAssignableRole('finance')).toBeFalse();
    expect(isAssignableRole('')).toBeFalse();
    expect(isAssignableRole(null)).toBeFalse();
  });

  it('labels roles via titlecase, including legacy finance', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('finance')).toBe('Finance');
    expect(roleLabel('')).toBe('');
    expect(roleLabel(undefined)).toBe('');
  });

  it('marks a retired role as legacy', () => {
    expect(legacyRoleLabel('finance')).toBe('Finance (legacy)');
  });
});
