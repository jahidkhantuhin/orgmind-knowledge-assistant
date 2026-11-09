'use client';

import { useState } from 'react';
import type { OrganizationMember, TeamGroup, WorkspaceInvitationSummary } from '@orgmind/shared';
import { OrganizationMembersTable } from './organization-members-table';
import { TeamGroupsPanel } from './team-groups-panel';
import { WorkspaceInvitationsPanel } from './workspace-invitations-panel';

export function WorkspaceMembersManager({
  organizationId,
  initialMembers,
  initialInvitations,
  initialGroups,
}: {
  organizationId: string;
  initialMembers: OrganizationMember[];
  initialInvitations: WorkspaceInvitationSummary[];
  initialGroups: TeamGroup[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);

  return (
    <>
      <WorkspaceInvitationsPanel
        organizationId={organizationId}
        invitations={invitations}
        onInvitationsUpdated={setInvitations}
      />
      <OrganizationMembersTable
        organizationId={organizationId}
        members={members}
        onMembersUpdated={setMembers}
        onInvitationsUpdated={setInvitations}
      />
      <TeamGroupsPanel
        organizationId={organizationId}
        members={members}
        onMembersUpdated={setMembers}
        initialGroups={initialGroups}
      />
    </>
  );
}
