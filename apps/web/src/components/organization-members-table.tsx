'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MembershipRoleSchema,
  type MembershipRole,
  type OrganizationMember,
} from '@orgmind/shared';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function OrganizationMembersTable({
  organizationId,
  initialMembers,
}: {
  organizationId: string;
  initialMembers: OrganizationMember[];
}) {
  const router = useRouter();
  const { confirm, notify, updateToast } = useFeedback();
  const [members, setMembers] = useState(initialMembers);
  const [removingUserId, setRemovingUserId] = useState('');
  const [savingRoleUserId, setSavingRoleUserId] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<Record<string, MembershipRole>>({});

  function selectedRole(member: OrganizationMember): MembershipRole {
    return selectedRoles[member.userId] ?? member.role;
  }

  async function updateMemberRole(member: OrganizationMember) {
    const role = selectedRole(member);
    if (role === member.role) return;
    setSavingRoleUserId(member.userId);
    const toastId = notify({
      kind: 'loading',
      title: 'Updating workspace role',
      description: `Changing ${member.name} to ${role}.`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.userId)}/role`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(message ?? 'Could not update this workspace member role.');
      }
      setMembers((current) =>
        current.map((item) => (item.userId === member.userId ? { ...item, role } : item)),
      );
      setSelectedRoles((current) => {
        const next = { ...current };
        delete next[member.userId];
        return next;
      });
      updateToast(toastId, {
        kind: 'success',
        title: 'Role updated',
        description: `${member.name} is now a ${role}.`,
        persistent: false,
      });
      router.refresh();
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not update role',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setSavingRoleUserId('');
    }
  }

  async function removeMember(member: OrganizationMember) {
    if (
      !(await confirm({
        title: `Remove ${member.name}?`,
        message: 'They will lose access to this workspace and its shared knowledge.',
        confirmLabel: 'Remove member',
      }))
    )
      return;
    setRemovingUserId(member.userId);
    const toastId = notify({
      kind: 'loading',
      title: 'Removing workspace member',
      description: `Removing ${member.name}…`,
    });
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
      updateToast(toastId, {
        kind: 'success',
        title: 'Member removed',
        description: `${member.name} no longer has access to this workspace.`,
        persistent: false,
      });
      router.refresh();
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not remove member',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
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
                    <span className="member-role-controls">
                      <select
                        aria-label={`Role for ${member.name}`}
                        value={selectedRole(member)}
                        disabled={savingRoleUserId === member.userId}
                        onChange={(event) =>
                          setSelectedRoles((current) => ({
                            ...current,
                            [member.userId]: MembershipRoleSchema.parse(event.target.value),
                          }))
                        }
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        className="secondary-button member-role-save"
                        disabled={
                          savingRoleUserId === member.userId || selectedRole(member) === member.role
                        }
                        onClick={() => void updateMemberRole(member)}
                      >
                        {savingRoleUserId === member.userId ? 'Saving…' : 'Save role'}
                      </button>
                    </span>
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
