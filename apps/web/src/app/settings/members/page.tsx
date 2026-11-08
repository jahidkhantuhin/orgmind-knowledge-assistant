import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  OrganizationMembersResponseSchema,
  RetrievalSettingsResponseSchema,
  TeamGroupsResponseSchema,
} from '@orgmind/shared';
import { ThemeToggle } from '../../../components/theme-toggle';
import { RetrievalSettingsPanel } from '../../../components/retrieval-settings-panel';
import { getCurrentUser } from '../../../lib/current-user';
import { TeamGroupsPanel } from '../../../components/team-groups-panel';
import { AddWorkspaceMemberForm } from '../../../components/add-workspace-member-form';

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
  const { members } = OrganizationMembersResponseSchema.parse(await response.json());
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
    <main className="members-page">
      <div className="members-page-top">
        <Link className="back-link" href="/">
          ← Back to workspace
        </Link>
        <ThemeToggle className="knowledge-theme-toggle" />
      </div>
      <p className="eyebrow">WORKSPACE SETTINGS</p>
      <h1>Members</h1>
      <p className="members-lead">People with access to {organization.organizationName}.</p>
      <p className="members-lead">
        Add a person after they have registered for OrgMind; this local setup does not send email
        invitations.
      </p>
      <AddWorkspaceMemberForm organizationId={organization.organizationId} />
      <section className="members-card">
        <div className="members-card-head">
          <strong>Workspace members</strong>
          <span>
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        {members.length === 0 ? (
          <p className="members-empty">No members found.</p>
        ) : (
          <div className="members-table-wrap">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId}>
                    <td>
                      <strong>{member.name}</strong>
                      <small>{member.email}</small>
                    </td>
                    <td>
                      <span className={`role-pill role-${member.role}`}>{member.role}</span>
                    </td>
                    <td>
                      {new Date(member.joinedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <TeamGroupsPanel
        key={members.length}
        organizationId={organization.organizationId}
        initialMembers={members}
        initialGroups={groups}
      />
      <RetrievalSettingsPanel
        organizationId={organization.organizationId}
        initialSettings={retrievalSettings}
      />
    </main>
  );
}
