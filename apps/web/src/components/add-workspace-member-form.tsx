'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MembershipRoleSchema, type MembershipRole } from '@orgmind/shared';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function AddWorkspaceMemberForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const { notify, updateToast } = useFeedback();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('viewer');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Adding workspace member',
      description: `Adding ${email} as ${role}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/members`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, role }),
        },
      );
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok)
        throw new Error(payload.error?.message ?? 'Could not add this workspace member.');
      setEmail('');
      updateToast(toastId, {
        kind: 'success',
        title: 'Member added',
        description: `${email} joined as ${role}.`,
        persistent: false,
      });
      router.refresh();
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not add member',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="team-group-create add-workspace-member"
      onSubmit={(event) => void submit(event)}
    >
      <label htmlFor="workspace-member-email">Add existing account</label>
      <input
        id="workspace-member-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="person@example.com"
      />
      <select
        aria-label="New member role"
        value={role}
        onChange={(event) => setRole(MembershipRoleSchema.parse(event.target.value))}
      >
        <option value="viewer">Viewer</option>
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button className="primary-button" type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add member'}
      </button>
    </form>
  );
}
