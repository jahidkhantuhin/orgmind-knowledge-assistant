import type { MembershipRole } from '@orgmind/shared';

export type DocumentAclInput = {
  roles: MembershipRole[];
  userIds: string[];
  groupIds: string[];
};

export function aclTokensForPrincipal(
  userId: string,
  role: MembershipRole,
  groupIds: string[] = [],
): string[] {
  return [...new Set([`role:${role}`, `user:${userId}`, ...groupIds.map((id) => `group:${id}`)])];
}

export function aclTokensForGrant(input: DocumentAclInput): string[] {
  return [
    ...new Set([
      'role:admin',
      ...input.roles.map((role) => `role:${role}`),
      ...input.userIds.map((id) => `user:${id}`),
      ...input.groupIds.map((id) => `group:${id}`),
    ]),
  ];
}

export function canReadAcl(acl: string[] | undefined, principalTokens: string[]): boolean {
  // Empty ACLs predate Step 8 and stay organization-wide until the backfill runs.
  if (!acl || acl.length === 0) return true;
  return acl.some((token) => principalTokens.includes(token));
}
