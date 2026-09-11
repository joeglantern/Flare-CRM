/**
 * Who may use the owner console, in the words both the console and its screens use.
 *
 * The permission sets themselves live in the console's own access control, because they are built
 * on Better Auth's. What lives here is only the vocabulary: the two role names and how to describe
 * each one to a person, so an invitation dialog, a row badge and an audit entry never disagree
 * about what support means.
 */
export const CONSOLE_ROLES = ['owner', 'support'] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];

export const CONSOLE_ROLE_COPY: Record<ConsoleRole, { label: string; description: string }> = {
  owner: {
    label: 'Owner',
    description: 'Everything here: plans, prices, entitlements, stacks and who else may sign in.',
  },
  support: {
    label: 'Support',
    description:
      'Sees the fleet and unsticks people who are locked out. Cannot change plans, prices, entitlements, stack credentials or accounts.',
  },
};

/** A role name read back from a database row written before the second role existed. */
export function consoleRoleOf(role: string | null | undefined): ConsoleRole {
  return role === 'support' ? 'support' : 'owner';
}
