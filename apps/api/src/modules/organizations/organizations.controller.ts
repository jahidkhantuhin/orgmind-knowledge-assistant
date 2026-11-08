import type { RequestHandler } from 'express';
import { listOrganizationMembers } from './organizations.service.js';
import {
  AddOrganizationMemberSchema,
  CreateTeamGroupSchema,
  TeamGroupSchema,
  TeamGroupsResponseSchema,
  UpdateMemberGroupsSchema,
} from '@orgmind/shared';
import { groupsRepository } from './groups.repository.js';
import { membershipsRepository } from './memberships.repository.js';
import { usersRepository } from '../users/users.repository.js';
import { OrganizationMemberSchema } from '@orgmind/shared';

export const listMembersController: RequestHandler = async (req, res) => {
  const routeOrganizationId = req.params.organizationId;
  const organizationId = Array.isArray(routeOrganizationId)
    ? routeOrganizationId[0]
    : routeOrganizationId;
  if (!organizationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Organization is required.' } });
    return;
  }
  res.json({ members: await listOrganizationMembers(organizationId) });
};

export const addOrganizationMemberController: RequestHandler = async (req, res) => {
  const organizationId = req.membership?.organizationId;
  const input = AddOrganizationMemberSchema.safeParse(req.body);
  if (!organizationId || !input.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_MEMBER', message: 'Enter a valid member email and role.' } });
    return;
  }
  const user = await usersRepository.findByEmail(input.data.email);
  if (!user) {
    res.status(404).json({
      error: {
        code: 'USER_NOT_FOUND',
        message: 'This person must create an OrgMind account before being added.',
      },
    });
    return;
  }
  if (await membershipsRepository.findForUserInOrganization(user.id, organizationId)) {
    res.status(409).json({
      error: { code: 'ALREADY_MEMBER', message: 'This person already belongs to the workspace.' },
    });
    return;
  }
  const membership = await membershipsRepository.ensureMembership(
    organizationId,
    user.id,
    input.data.role,
  );
  res.status(201).json({
    member: OrganizationMemberSchema.parse({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: membership.role,
      groupIds: membership.groupIds,
      joinedAt: membership.createdAt.toISOString(),
    }),
  });
};

export const listTeamGroupsController: RequestHandler = async (req, res) => {
  const organizationId = req.membership?.organizationId;
  if (!organizationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Organization is required.' } });
    return;
  }
  res.json(
    TeamGroupsResponseSchema.parse({
      groups: (await groupsRepository.list(organizationId)).map((group) => ({
        id: group._id,
        organizationId: group.organizationId,
        name: group.name,
        createdAt: group.createdAt.toISOString(),
      })),
    }),
  );
};

export const createTeamGroupController: RequestHandler = async (req, res) => {
  const organizationId = req.membership?.organizationId;
  const input = CreateTeamGroupSchema.safeParse(req.body);
  if (!organizationId || !input.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_GROUP', message: 'Enter a valid group name.' } });
    return;
  }
  const group = await groupsRepository.create(organizationId, input.data.name);
  res.status(201).json({
    group: TeamGroupSchema.parse({
      id: group._id,
      organizationId: group.organizationId,
      name: group.name,
      createdAt: group.createdAt.toISOString(),
    }),
  });
};

export const updateMemberGroupsController: RequestHandler = async (req, res) => {
  const organizationId = req.membership?.organizationId;
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const input = UpdateMemberGroupsSchema.safeParse(req.body);
  if (!organizationId || !userId || !input.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_GROUPS', message: 'Choose valid team groups.' } });
    return;
  }
  const groupIds = [...new Set(input.data.groupIds)];
  const existingGroupIds = await groupsRepository.findIds(organizationId, groupIds);
  if (existingGroupIds.length !== groupIds.length) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_GROUPS', message: 'A selected team group is invalid.' } });
    return;
  }
  const updated = await membershipsRepository.setGroupIdsForUserInOrganization(
    userId,
    organizationId,
    groupIds,
  );
  if (!updated) {
    res
      .status(404)
      .json({ error: { code: 'MEMBER_NOT_FOUND', message: 'Workspace member not found.' } });
    return;
  }
  res.json({ groupIds });
};
