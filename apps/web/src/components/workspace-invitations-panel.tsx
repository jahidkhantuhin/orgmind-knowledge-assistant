'use client';

import { useState, type FormEvent } from 'react';
import {
  CreateWorkspaceInvitationResponseSchema,
  type MembershipRole,
  type WorkspaceInvitationSummary,
} from '@orgmind/shared';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function WorkspaceInvitationsPanel({
  organizationId,
  invitations,
  onInvitationsUpdated,
}: {
  organizationId: string;
  invitations: WorkspaceInvitationSummary[];
  onInvitationsUpdated: (_invitations: WorkspaceInvitationSummary[]) => void;
}) {
  const { confirm, notify, updateToast } = useFeedback();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('viewer');
  const [manualCopyLinks, setManualCopyLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function issueInvitation(
    targetEmail: string,
    targetRole: MembershipRole,
    clearForm = false,
  ) {
    setPending(true);
    setError('');
    const toastId = notify({
      kind: 'loading',
      title: 'Creating invitation',
      description: `Preparing a ${targetRole} invite for ${targetEmail}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/invitations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: targetEmail, role: targetRole }),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiMessage =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(apiMessage ?? 'Could not create this invitation.');
      }
      const created = CreateWorkspaceInvitationResponseSchema.parse(payload);
      const link = new URL('/register', window.location.origin);
      link.searchParams.set('invite', created.code);
      const replacedInvitationIds = invitations
        .filter((item) => item.email === created.invitation.email)
        .map((item) => item.id);
      onInvitationsUpdated([
        created.invitation,
        ...invitations.filter((item) => item.email !== created.invitation.email),
      ]);
      setManualCopyLinks((current) => {
        const next = { ...current };
        replacedInvitationIds.forEach((id) => delete next[id]);
        return next;
      });
      try {
        await navigator.clipboard.writeText(link.toString());
        updateToast(toastId, {
          kind: 'success',
          title: 'Invitation link copied',
          description: `Share the link with ${created.invitation.email}. It expires in 7 days.`,
          persistent: false,
        });
      } catch {
        setManualCopyLinks((current) => ({
          ...current,
          [created.invitation.id]: link.toString(),
        }));
        updateToast(toastId, {
          kind: 'error',
          title: 'Invitation created; copy it manually',
          description:
            'The browser blocked clipboard access. Select the link shown in the invitation row.',
          persistent: false,
        });
      }
      if (clearForm) setEmail('');
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not create invitation',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setPending(false);
    }
  }

  function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void issueInvitation(email.trim().toLowerCase(), role, true);
  }

  async function recreateInvitation(invitation: WorkspaceInvitationSummary) {
    if (
      !(await confirm({
        title: 'Create a replacement link?',
        message: `The current link for ${invitation.email} will stop working when the replacement is created.`,
        confirmLabel: 'Create replacement',
      }))
    )
      return;
    void issueInvitation(invitation.email, invitation.role);
  }

  async function revokeInvitation(invitationId: string) {
    const invitation = invitations.find((item) => item.id === invitationId);
    if (
      !invitation ||
      !(await confirm({
        title: 'Revoke this invitation?',
        message: `The invite link for ${invitation.email} will stop working immediately.`,
        confirmLabel: 'Revoke invite',
      }))
    )
      return;
    const toastId = notify({
      kind: 'loading',
      title: 'Revoking invitation',
      description: `Invalidating the link for ${invitation.email}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok) throw new Error('Could not revoke this invitation.');
      onInvitationsUpdated(invitations.filter((item) => item.id !== invitationId));
      setManualCopyLinks((current) => {
        const next = { ...current };
        delete next[invitationId];
        return next;
      });
      updateToast(toastId, {
        kind: 'success',
        title: 'Invitation revoked',
        description: `The link for ${invitation.email} can no longer be used.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not revoke invitation',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  return (
    <section className="members-card workspace-invitations-card">
      <div className="members-card-head">
        <strong>Invite someone to this workspace</strong>
        <span>Private invite links</span>
      </div>
      <p className="workspace-invitations-help">
        Invite links are tied to an email address, expire after 7 days, and can be used once.
      </p>
      <form className="team-group-create workspace-invitation-form" onSubmit={createInvitation}>
        <label htmlFor="workspace-invite-email">Invite email</label>
        <input
          id="workspace-invite-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          placeholder="person@example.com"
        />
        <label htmlFor="workspace-invite-role">Role</label>
        <select
          id="workspace-invite-role"
          value={role}
          onChange={(event) => setRole(event.target.value as MembershipRole)}
        >
          <option value="viewer">Viewer</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create invite'}
        </button>
      </form>
      {error && (
        <p className="workspace-invitation-error" role="alert">
          {error}
        </p>
      )}
      {invitations.length > 0 && (
        <div className="workspace-invitation-list">
          <strong>Pending invitations</strong>
          {invitations.map((invitation) => (
            <div className="workspace-invitation-item" key={invitation.id}>
              <div className="workspace-invitation-row">
                <span>
                  <strong>{invitation.email}</strong>
                  <small>
                    {invitation.role} · expires{' '}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </small>
                </span>
                <div className="workspace-invitation-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pending}
                    onClick={() => void recreateInvitation(invitation)}
                  >
                    Recreate &amp; copy
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={pending}
                    onClick={() => void revokeInvitation(invitation.id)}
                  >
                    Revoke
                  </button>
                </div>
              </div>
              {manualCopyLinks[invitation.id] && (
                <div className="workspace-invite-link workspace-invite-link-fallback">
                  <label htmlFor={`invite-link-${invitation.id}`}>Select and copy this link</label>
                  <input
                    id={`invite-link-${invitation.id}`}
                    readOnly
                    value={manualCopyLinks[invitation.id]}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
