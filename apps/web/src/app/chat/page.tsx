import { redirect } from 'next/navigation';
import { ChatWorkspace } from '../../components/chat-workspace';
import { getCurrentUser } from '../../lib/current-user';

export default async function ChatPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');
  const organization = currentUser.organizations[0];
  if (!organization) redirect('/');

  return (
    <ChatWorkspace
      organizationId={organization.organizationId}
      organizationName={organization.organizationName}
    />
  );
}
