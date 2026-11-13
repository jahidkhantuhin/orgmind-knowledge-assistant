import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  GitHubIntegrationsResponseSchema,
  GoogleDriveIntegrationsResponseSchema,
} from '@orgmind/shared';
import { IntegrationTabs } from '../../../components/integration-tabs';
import { WorkspaceNavigation } from '../../../components/workspace-navigation';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export default async function IntegrationsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization || organization.role !== 'admin') redirect('/');

  const cookie = (await headers()).get('cookie') ?? '';
  const [githubResponse, driveResponse] = await Promise.all([
    fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/integrations`,
      {
        headers: { cookie },
        cache: 'no-store',
      },
    ),
    fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/integrations/google-drive`,
      {
        headers: { cookie },
        cache: 'no-store',
      },
    ),
  ]);
  if (!githubResponse.ok || !driveResponse.ok)
    throw new Error('Unable to load workspace integrations.');
  const { integrations } = GitHubIntegrationsResponseSchema.parse(await githubResponse.json());
  const { integrations: driveIntegrations } = GoogleDriveIntegrationsResponseSchema.parse(
    await driveResponse.json(),
  );

  return (
    <>
      <WorkspaceNavigation active="integrations" role={organization.role} />
      <main className="integrations-page">
        <p className="eyebrow">WORKSPACE SETTINGS</p>
        <h1>Integrations</h1>
        <p className="integrations-page-lead">
          Connect a file, choose who can search it, then sync updates when the source changes.
          Imported files follow the same indexing and access rules as uploaded documents.
        </p>
        <IntegrationTabs
          organizationId={organization.organizationId}
          githubIntegrations={integrations}
          driveIntegrations={driveIntegrations}
        />
      </main>
    </>
  );
}
