import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { DocumentDetailResponseSchema } from '@orgmind/shared';
import { DocumentDetail } from '../../../components/document-detail';
import { getCurrentUser } from '../../../lib/current-user';

const apiUrl =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization) redirect('/');
  const { documentId } = await params;
  const cookie = (await headers()).get('cookie') ?? '';
  const response = await fetch(
    `${apiUrl}/organizations/${encodeURIComponent(organization.organizationId)}/documents/${encodeURIComponent(documentId)}`,
    { headers: { cookie }, cache: 'no-store' },
  );
  if (response.status === 404) notFound();
  if (!response.ok) redirect('/knowledge');

  const detail = DocumentDetailResponseSchema.parse(await response.json());
  return (
    <DocumentDetail
      detail={detail}
      organizationName={organization.organizationName}
      organizationId={organization.organizationId}
      role={organization.role}
    />
  );
}
