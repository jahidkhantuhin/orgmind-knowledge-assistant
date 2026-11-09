'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  CreateWorkspaceInvitationResponseSchema,
  WorkspaceInvitationsResponseSchema,
  type MembershipRole,
  type WorkspaceInvitationSummary,
} from '@orgmind/shared';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function WorkspaceInvitationsPanel({ organizationId }: { organizationId: string }) {
  const { confirm, notify, updateToast } = useFeedback();
  const [invitations, setInvitations] = useState<WorkspaceInvitationSummary[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('viewer');
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/organizations/${encodeURIComponent(organizationId)}/invitations`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error('Could not load invitations.');
        setInvitations(WorkspaceInvitationsResponseSchema.parse(payload).invitations);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load invitations.');
        }
      });
    return () => controller.abort();
  }, [organizationId]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setInviteLink('');
    const toastId = notify({
      kind: 'loading',
      title: 'Creating invitation',
      description: `Preparing a ${role} invite for ${email}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/invitations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, role }),
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
      setInviteLink(link.toString());
      setInvitations((current) => [
        created.invitation,
        ...current.filter((item) => item.email !== created.invitation.email),
      ]);
      updateToast(toastId, {
        kind: 'success',
        title: 'Invitation ready',
        description: `Share the private link with ${created.invitation.email}. It expires in 7 days.`,
        persistent: false,
      });
      setEmail('');
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
      setInvitations((current) => current.filter((item) => item.id !== invitationId));
      setInviteLink('');
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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      notify({ kind: 'success', title: 'Invite link copied', description: 'It’s ready to share.' });
    } catch {
      notify({
        kind: 'error',
        title: 'Could not copy link',
        description: 'Select and copy the invitation link below.',
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
      {inviteLink && (
        <div className="workspace-invite-link">
          <label htmlFor="created-invite-link">Share this link with {invitations[0]?.email}</label>
          <div>
            <input
              id="created-invite-link"
              readOnly
              value={inviteLink}
              onFocus={(event) => event.target.select()}
            />
            <button className="secondary-button" type="button" onClick={() => void copyLink()}>
              Copy link
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="workspace-invitation-error" role="alert">
          {error}
        </p>
      )}
      {invitations.length > 0 && (
        <div className="workspace-invitation-list">
          <strong>Pending invitations</strong>
          {invitations.map((invitation) => (
            <div className="workspace-invitation-row" key={invitation.id}>
              <span>
                <strong>{invitation.email}</strong>
                <small>
                  {invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </small>
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => void revokeInvitation(invitation.id)}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
