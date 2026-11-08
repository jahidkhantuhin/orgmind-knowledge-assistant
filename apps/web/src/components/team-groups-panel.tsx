'use client';

import { useState, type FormEvent } from 'react';
import { type OrganizationMember, type TeamGroup } from '@orgmind/shared';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function TeamGroupsPanel({
  organizationId,
  initialMembers,
  initialGroups,
}: {
  organizationId: string;
  initialMembers: OrganizationMember[];
  initialGroups: TeamGroup[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [groups, setGroups] = useState(initialGroups);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
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
      setMessage('Team group created. Assign members below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create this team group.');
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(member: OrganizationMember, groupId: string, checked: boolean) {
    const groupIds = checked
      ? [...new Set([...member.groupIds, groupId])]
      : member.groupIds.filter((id) => id !== groupId);
    setError('');
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
      setMembers((current) =>
        current.map((item) => (item.userId === member.userId ? { ...item, groupIds } : item)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update team membership.');
    }
  }

  return (
    <section className="members-card team-groups-card">
      <div className="members-card-head">
        <strong>Teams and groups</strong>
        <span>{groups.length} groups</span>
      </div>
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
      {error && (
        <p className="knowledge-message error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="knowledge-message success" role="status">
          {message}
        </p>
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
    </section>
  );
}
