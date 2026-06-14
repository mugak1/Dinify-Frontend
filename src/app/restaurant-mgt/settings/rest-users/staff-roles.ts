/**
 * Staff role catalogue for the Staff & roles settings section.
 *
 * `finance` was retired from the picker (PR6): it is no longer offered when
 * adding staff or as a fresh choice when editing. Any pre-existing finance-role
 * user is still handled gracefully on display via `roleLabel` (titlecase
 * fallback) and surfaced in the Edit picker as a "(legacy)" option so editing
 * never blanks or silently changes their role — see `legacyRoleLabel`.
 *
 * This is a frontend picker change only; the backend still validates roles and
 * keeps any existing finance assignments.
 */
export type AssignableRole = 'owner' | 'manager' | 'kitchen' | 'waiter';

export const ASSIGNABLE_ROLES: readonly AssignableRole[] = [
  'owner',
  'manager',
  'kitchen',
  'waiter',
];

/** True when a role string is one still offered in the picker. */
export function isAssignableRole(role: string | null | undefined): boolean {
  return !!role && (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/**
 * Display label for any role string. Mirrors the previous `| titlecase`
 * rendering so a retired/unknown role (e.g. `finance`) shows as "Finance"
 * rather than blank — the graceful-display guarantee for legacy users.
 */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Label for a no-longer-assignable role shown in the Edit picker. */
export function legacyRoleLabel(role: string): string {
  return `${roleLabel(role)} (legacy)`;
}
