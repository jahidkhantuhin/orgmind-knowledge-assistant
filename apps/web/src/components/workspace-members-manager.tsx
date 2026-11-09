'use client';

import { useState } from 'react';
import type { OrganizationMember, TeamGroup } from '@orgmind/shared';
import { OrganizationMembersTable } from './organization-members-table';
import { TeamGroupsPanel } from './team-groups-panel';

export function WorkspaceMembersManager({
  organizationId,
  initialMembers,
  initialGroups,
}: {
  organizationId: string;
  initialMembers: OrganizationMember[];
  initialGroups: TeamGroup[];
}) {
  const [members, setMembers] = useState(initialMembers);

  return (
    <>
      <OrganizationMembersTable
        organizationId={organizationId}
        members={members}
        onMembersUpdated={setMembers}
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
