'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrganizationMember } from '@orgmind/shared';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function OrganizationMembersTable({
  organizationId,
  initialMembers,
}: {
  organizationId: string;
  initialMembers: OrganizationMember[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [error, setError] = useState('');
  const [removingUserId, setRemovingUserId] = useState('');

  async function removeMember(member: OrganizationMember) {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    setError('');
    setRemovingUserId(member.userId);
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.userId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(message ?? 'Could not remove this workspace member.');
      }
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this workspace member.');
    } finally {
      setRemovingUserId('');
    }
  }

  return (
    <section className="members-card">
      <div className="members-card-head">
        <strong>Workspace members</strong>
        <span>
          {members.length} {members.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      {error && (
        <p className="knowledge-message error" role="alert">
          {error}
        </p>
      )}
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
                <th>Actions</th>
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
                  <td>
                    <button
                      type="button"
                      className="member-remove-button"
                      disabled={removingUserId === member.userId}
                      onClick={() => void removeMember(member)}
                    >
                      {removingUserId === member.userId ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
