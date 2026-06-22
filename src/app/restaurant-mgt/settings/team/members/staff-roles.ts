/**
 * Staff role catalogue for the Team → Members settings section.
 *
 * PR E aligned the picker to the four backend roles. The Staff role's wire
 * value is `restaurant_staff` (the value C's permission system keys on); the
 * legacy `waiter` value is retired from the picker, as is `finance`. The
 * picker no longer offers `owner` (ownership transfer is out of scope), but
 * `owner` remains a *displayable* role so an existing owner renders + edits
 * without being mislabelled.
 *
 * Two catalogues:
 *  - ASSIGNABLE_ROLES — what the Add picker offers and what an edit may switch
 *    to (manager / kitchen / restaurant_staff).
 *  - DISPLAYABLE_ROLES — every role the UI renders as a current, valid role
 *    (the assignable three plus owner). A role outside DISPLAYABLE_ROLES (e.g.
 *    a pre-existing `finance` or `waiter` assignment) is "legacy": shown
 *    gracefully on display and surfaced in the Edit picker as "(legacy)" so
 *    editing never blanks or silently changes it — see `legacyRoleLabel`.
 *
 * This is a frontend picker change only; the backend still validates roles and
 * keeps any existing legacy assignments.
 */
export type AssignableRole = 'manager' | 'kitchen' | 'restaurant_staff';
export type DisplayableRole = 'owner' | AssignableRole;

export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  'manager',
  'kitchen',
  'restaurant_staff',
];

export const DISPLAYABLE_ROLES: readonly DisplayableRole[] = [
  'owner',
  'manager',
  'kitchen',
  'restaurant_staff',
];

/** Friendly labels for the known roles; everything else falls back to titlecase. */
const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  kitchen: 'Chef',
  restaurant_staff: 'Staff',
};

/** True when a role string is one the Add/Edit picker may assign. */
export function isAssignableRole(role: string | null | undefined): boolean {
  return !!role && (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** True when a role string is a current, valid role the UI renders (incl. owner). */
export function isDisplayableRole(role: string | null | undefined): boolean {
  return !!role && (DISPLAYABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Display label for any role string. Known roles use the friendly map (e.g.
 * `kitchen` → "Chef", `restaurant_staff` → "Staff"); a retired/unknown role
 * (e.g. `finance`, `waiter`) falls back to titlecase so it shows "Finance" /
 * "Waiter" rather than blank — the graceful-display guarantee for legacy users.
 */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_LABELS[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/** Label for a no-longer-displayable (legacy) role shown in the Edit picker. */
export function legacyRoleLabel(role: string): string {
  return `${roleLabel(role)} (legacy)`;
}
