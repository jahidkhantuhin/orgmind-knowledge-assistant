import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { GitHubIntegrationsResponseSchema } from '@orgmind/shared';
import { IntegrationsManager } from '../../../components/integrations-manager';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default async function IntegrationsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');

  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/integrations`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (!response.ok) throw new Error('Unable to load workspace integrations.');
  const { integrations } = GitHubIntegrationsResponseSchema.parse(await response.json());

  return (
    <>
      <WorkspaceNavigation active="integrations" role={organization.role} />
      <main className="integrations-page">
        <p className="eyebrow">WORKSPACE SETTINGS</p>
        <h1>Integrations</h1>
        <p className="integrations-page-lead">
          Bring a repository file into your workspace knowledge and control who can search it.
        </p>
        <IntegrationsManager
          organizationId={organization.organizationId}
          initialIntegrations={integrations}
        />
      </main>
    </>
  );
}
