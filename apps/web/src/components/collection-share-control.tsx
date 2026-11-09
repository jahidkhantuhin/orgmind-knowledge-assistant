'use client';

import { useState } from 'react';
import { useFeedback } from './feedback-provider';
import {
  DocumentCollectionAccessResponseSchema,
  OrganizationMembersResponseSchema,
  TeamGroupsResponseSchema,
  type MembershipRole,
  type OrganizationMember,
  type TeamGroup,
} from '@orgmind/shared';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const allRoles: MembershipRole[] = ['admin', 'member', 'viewer'];

export function CollectionShareControl({
  organizationId,
  collectionId,
  documentId,
  documentName,
  acl,
}: {
  organizationId: string;
  collectionId: string;
  documentId: string;
  documentName: string;
  acl: string[];
}) {
  const { notify, updateToast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [roles, setRoles] = useState<MembershipRole[]>(
    allRoles.filter((role) => acl.includes(`role:${role}`)),
  );
  const [userIds, setUserIds] = useState<string[]>(
    acl.filter((token) => token.startsWith('user:')).map((token) => token.slice(5)),
  );
  const [groupIds, setGroupIds] = useState<string[]>(
    acl.filter((token) => token.startsWith('group:')).map((token) => token.slice(6)),
  );
  const [folderAcl, setFolderAcl] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'document' | 'folder'>('document');
  function selectAccess(tokens: string[]) {
    setRoles(allRoles.filter((role) => tokens.includes(`role:${role}`)));
    setUserIds(tokens.filter((token) => token.startsWith('user:')).map((token) => token.slice(5)));
    setGroupIds(
      tokens.filter((token) => token.startsWith('group:')).map((token) => token.slice(6)),
    );
  }

  async function showDialog() {
    setOpen(true);
    setLoading(true);
    setError('');
    try {
      const [memberResponse, groupResponse, accessResponse] = await Promise.all([
        fetch(`${apiUrl}/organizations/${encodeURIComponent(organizationId)}/members`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(`${apiUrl}/organizations/${encodeURIComponent(organizationId)}/groups`, {
          credentials: 'include',
          cache: 'no-store',
        }),
        fetch(
          `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/collections/${encodeURIComponent(collectionId)}/access`,
          { credentials: 'include', cache: 'no-store' },
        ),
      ]);
      if (!memberResponse.ok || !groupResponse.ok || !accessResponse.ok)
        throw new Error('Unable to load sharing options.');
      setMembers(OrganizationMembersResponseSchema.parse(await memberResponse.json()).members);
      setGroups(TeamGroupsResponseSchema.parse(await groupResponse.json()).groups);
      const currentFolderAcl = DocumentCollectionAccessResponseSchema.parse(
        await accessResponse.json(),
      ).acl;
      setFolderAcl(currentFolderAcl);
      setScope('document');
      selectAccess(acl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load sharing options.');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    const toastId = notify({
      kind: 'loading',
      title: 'Saving access settings',
      description: `Updating who can access ${scope === 'folder' ? `the “${collectionId}” folder` : documentName}…`,
    });
    try {
      const path =
        scope === 'document'
          ? `documents/${encodeURIComponent(documentId)}/access`
          : `collections/${encodeURIComponent(collectionId)}/access`;
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/${path}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            scope === 'folder'
              ? { collectionId, roles, userIds, groupIds }
              : { roles, userIds, groupIds },
          ),
        },
      );
      if (!response.ok) throw new Error('Could not update folder access. Please try again.');
      updateToast(toastId, {
        kind: 'success',
        title: 'Access settings saved',
        description:
          scope === 'folder'
            ? `Updated access for the “${collectionId}” folder.`
            : `Updated access for ${documentName}.`,
        persistent: false,
      });
      setOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not update folder access.';
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not save access settings',
        description: message,
        persistent: false,
      });
    } finally {
      setBusy(false);
    }
  }

  function toggle<T extends string>(
    items: T[],
    setItems: (_next: T[]) => void,
    item: T,
    checked: boolean,
  ) {
    setItems(checked ? [...new Set([...items, item])] : items.filter((value) => value !== item));
  }

  return (
    <>
      <button
        className="document-share"
        type="button"
        onClick={() => void showDialog()}
        aria-label={`Share folder ${collectionId}`}
      >
        Share
      </button>
      {open && (
        <div
          className="share-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
          >
            <header>
              <div>
                <p className="eyebrow">DOCUMENT ACCESS</p>
                <h2 id="share-title">
                  {scope === 'folder'
                    ? `Share folder “${collectionId}”`
                    : `Share “${documentName}”`}
                </h2>
              </div>
              <button
                type="button"
                className="share-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <p>
              {scope === 'folder'
                ? 'These permissions apply to every document in this folder.'
                : 'These permissions apply to this document only.'}{' '}
              Workspace admins always retain access.
            </p>
            <fieldset className="share-scope">
              <legend>Apply access to</legend>
              <label>
                <input
                  type="radio"
                  name={`share-scope-${documentId}`}
                  checked={scope === 'document'}
                  onChange={() => {
                    setScope('document');
                    selectAccess(acl);
                  }}
                />{' '}
                This document only
              </label>
              <label>
                <input
                  type="radio"
                  name={`share-scope-${documentId}`}
                  checked={scope === 'folder'}
                  onChange={() => {
                    setScope('folder');
                    selectAccess(folderAcl);
                  }}
                />{' '}
                Entire folder ({collectionId})
              </label>
            </fieldset>
            {loading ? (
              <p>Loading people and groups…</p>
            ) : (
              <div className="share-options">
                <fieldset>
                  <legend>Workspace roles</legend>
                  {allRoles.map((role) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={role === 'admin' || roles.includes(role)}
                        disabled={role === 'admin'}
                        onChange={(event) => toggle(roles, setRoles, role, event.target.checked)}
                      />{' '}
                      {role === 'admin'
                        ? 'Admins (always retain access)'
                        : role === 'member'
                          ? 'Members'
                          : 'Viewers'}
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Specific people</legend>
                  {members.map((member) => (
                    <label key={member.userId}>
                      <input
                        type="checkbox"
                        checked={userIds.includes(member.userId)}
                        onChange={(event) =>
                          toggle(userIds, setUserIds, member.userId, event.target.checked)
                        }
                      />{' '}
                      {member.name} <span>{member.email}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Teams and groups</legend>
                  {groups.length === 0 ? (
                    <small>Create groups in Settings → Members first.</small>
                  ) : (
                    groups.map((group) => (
                      <label key={group.id}>
                        <input
                          type="checkbox"
                          checked={groupIds.includes(group.id)}
                          onChange={(event) =>
                            toggle(groupIds, setGroupIds, group.id, event.target.checked)
                          }
                        />{' '}
                        {group.name}
                      </label>
                    ))
                  )}
                </fieldset>
              </div>
            )}
            {error && (
              <p className="knowledge-message error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button className="secondary-button" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void save()}
                disabled={busy || loading}
              >
                {busy ? 'Saving…' : 'Save access'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
