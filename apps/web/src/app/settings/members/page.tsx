import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  OrganizationMembersResponseSchema,
  RetrievalSettingsResponseSchema,
  TeamGroupsResponseSchema,
} from '@orgmind/shared';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { RetrievalSettingsPanel } from '../../../components/retrieval-settings-panel';
import { getCurrentUser } from '../../../lib/current-user';
import { AddWorkspaceMemberForm } from '../../../components/add-workspace-member-form';
import { WorkspaceMembersManager } from '../../../components/workspace-members-manager';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default async function MembersPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');

  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/members`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load organization members.');
  const { members, invitations } = OrganizationMembersResponseSchema.parse(await response.json());
  const groupsResponse = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/groups`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!groupsResponse.ok) throw new Error('Unable to load team groups.');
  const { groups } = TeamGroupsResponseSchema.parse(await groupsResponse.json());
  const settingsResponse = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/chat/retrieval-settings`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!settingsResponse.ok) throw new Error('Unable to load retrieval settings.');
  const retrievalSettings = RetrievalSettingsResponseSchema.parse(await settingsResponse.json());

  return (
    <>
      <WorkspaceNavigation active="members" role={organization.role} />
      <main className="members-page">
        <p className="eyebrow">WORKSPACE SETTINGS</p>
        <h1>Members</h1>
        <p className="members-lead">People with access to {organization.organizationName}.</p>
        <p className="members-lead">
          Add a person after they have registered for OrgMind; this local setup does not send email
          invitations.
        </p>
        <AddWorkspaceMemberForm organizationId={organization.organizationId} />
        <WorkspaceMembersManager
          key={JSON.stringify(members)}
          organizationId={organization.organizationId}
          initialMembers={members}
          initialInvitations={invitations}
          initialGroups={groups}
        />
        <RetrievalSettingsPanel
          organizationId={organization.organizationId}
          initialSettings={retrievalSettings}
        />
      </main>
    </>
  );
}
