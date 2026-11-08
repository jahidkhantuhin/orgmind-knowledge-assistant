import {
  OrganizationMembershipSchema,
  OrganizationMemberSchema,
  type OrganizationMembership,
  type OrganizationMember,
} from '@orgmind/shared';
import { organizationsRepository } from './organizations.repository.js';
import { membershipsRepository } from './memberships.repository.js';
import { usersRepository } from '../users/users.repository.js';

export async function provisionPersonalOrganization(
  userId: string,
  organizationName: string,
): Promise<void> {
  const organization = await organizationsRepository.createForOwner(organizationName, userId);
  await membershipsRepository.ensureMembership(organization._id, userId, 'admin');
}

export async function listMembershipsForUser(userId: string): Promise<OrganizationMembership[]> {
  const memberships = await membershipsRepository.findForUser(userId);
  const organizations = await organizationsRepository.findByIds(
    memberships.map((membership) => membership.organizationId),
  );
  const organizationById = new Map(
    organizations.map((organization) => [organization._id, organization]),
  );

  return memberships.flatMap((membership) => {
    const organization = organizationById.get(membership.organizationId);
    if (!organization) return [];
    return [
      OrganizationMembershipSchema.parse({
        id: membership._id,
        organizationId: organization._id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        role: membership.role,
        groupIds: membership.groupIds,
      }),
    ];
  });
}

export async function listOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const memberships = await membershipsRepository.findForOrganization(organizationId);
  const users = await usersRepository.findByIds(memberships.map((membership) => membership.userId));
  const userById = new Map(users.map((user) => [user.id, user]));

  return memberships.flatMap((membership) => {
    const user = userById.get(membership.userId);
    if (!user) return [];
    return [
      OrganizationMemberSchema.parse({
        userId: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        joinedAt: membership.createdAt.toISOString(),
      }),
    ];
  });
}
