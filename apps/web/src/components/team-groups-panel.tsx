'use client';

import { useState, type FormEvent } from 'react';
import { type OrganizationMember, type TeamGroup } from '@orgmind/shared';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export function TeamGroupsPanel({
  organizationId,
  members,
  onMembersUpdated,
  initialGroups,
}: {
  organizationId: string;
  members: OrganizationMember[];
  onMembersUpdated: (_updatedMembers: OrganizationMember[]) => void;
  initialGroups: TeamGroup[];
}) {
  const { confirm, notify, updateToast } = useFeedback();
  const [groups, setGroups] = useState(initialGroups);
  const [name, setName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Creating team group',
      description: `Setting up “${name.trim()}”…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/groups`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      if (!response.ok) throw new Error('Could not create this team group.');
      const payload = (await response.json()) as { group: TeamGroup };
      setGroups((current) =>
        [...current, payload.group].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setName('');
      updateToast(toastId, {
        kind: 'success',
        title: 'Group created',
        description: 'Assign members or share a knowledge folder with this group.',
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not create group',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(member: OrganizationMember, groupId: string, checked: boolean) {
    const groupIds = checked
      ? [...new Set([...member.groupIds, groupId])]
      : member.groupIds.filter((id) => id !== groupId);
    const toastId = notify({
      kind: 'loading',
      title: 'Updating group access',
      description: `${checked ? 'Adding' : 'Removing'} ${member.name}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.userId)}/groups`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ groupIds }),
        },
      );
      if (!response.ok) throw new Error('Could not update team membership.');
      onMembersUpdated(
        members.map((item) => (item.userId === member.userId ? { ...item, groupIds } : item)),
      );
      updateToast(toastId, {
        kind: 'success',
        title: 'Group access updated',
        description: `${member.name} ${checked ? 'added to' : 'removed from'} the group.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not update group access',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  async function renameGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Renaming team group',
      description: `Renaming to “${editingName.trim()}”…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/groups/${encodeURIComponent(editingGroupId)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: editingName }),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(message ?? 'Could not rename this team group.');
      }
      const updated = (payload as { group: TeamGroup }).group;
      setGroups((current) =>
        current
          .map((group) => (group.id === updated.id ? updated : group))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditingGroupId('');
      setEditingName('');
      updateToast(toastId, {
        kind: 'success',
        title: 'Group renamed',
        description: `The group is now “${updated.name}”.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not rename group',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(group: TeamGroup) {
    if (
      !(await confirm({
        title: `Delete “${group.name}”?`,
        message: 'Members will lose access to knowledge shared through this group.',
        confirmLabel: 'Delete group',
      }))
    )
      return;
    const toastId = notify({
      kind: 'loading',
      title: 'Deleting team group',
      description: `Removing “${group.name}” and its assignments…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/groups/${encodeURIComponent(group.id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiMessage =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(apiMessage ?? 'Could not delete this team group.');
      }
      setGroups((current) => current.filter((item) => item.id !== group.id));
      onMembersUpdated(
        members.map((member) => ({
          ...member,
          groupIds: member.groupIds.filter((id) => id !== group.id),
        })),
      );
      updateToast(toastId, {
        kind: 'success',
        title: 'Group deleted',
        description: `“${group.name}” and its member assignments were removed.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not delete group',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  return (
    <section className="members-card team-groups-card">
      <div className="members-card-head">
        <strong>Teams and groups</strong>
        <span>{groups.length} groups</span>
      </div>
      <div className="team-groups-content">
        <p className="team-groups-help">
          Create a group, then assign workspace members. Groups can be used to share knowledge
          folders.
        </p>
        <form className="team-group-create" onSubmit={(event) => void createGroup(event)}>
          <label htmlFor="team-group-name">New group</label>
          <input
            id="team-group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={80}
            required
            placeholder="e.g. People Operations"
          />
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </form>
        {groups.length > 0 && (
          <div className="team-group-admin-list">
            <strong>Manage groups</strong>
            {groups.map((group) =>
              editingGroupId === group.id ? (
                <form className="team-group-edit-form" key={group.id} onSubmit={renameGroup}>
                  <input
                    aria-label={`Rename ${group.name}`}
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    minLength={2}
                    maxLength={80}
                    required
                    autoFocus
                  />
                  <button className="secondary-button" type="submit" disabled={busy}>
                    Save
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setEditingGroupId('')}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="team-group-admin-row" key={group.id}>
                  <span>{group.name}</span>
                  <div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setEditingGroupId(group.id);
                        setEditingName(group.name);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="member-remove-button"
                      type="button"
                      onClick={() => void deleteGroup(group)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
        {groups.length > 0 && members.length > 0 && (
          <div className="team-group-members">
            {members.map((member) => (
              <div className="team-group-member" key={member.userId}>
                <div>
                  <strong>{member.name}</strong>
                  <small>{member.email}</small>
                </div>
                <div className="team-group-checks">
                  {groups.map((group) => (
                    <label key={group.id}>
                      <input
                        type="checkbox"
                        checked={member.groupIds.includes(group.id)}
                        onChange={(event) =>
                          void updateMember(member, group.id, event.target.checked)
                        }
                      />{' '}
                      {group.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
