'use client';

import { useState, type FormEvent } from 'react';
import {
  GitHubIntegrationsResponseSchema,
  GitHubIntegrationSchema,
  type GitHubIntegration,
} from '@orgmind/shared';
import { useFeedback } from './feedback-provider';
import { IntegrationButton } from './integration-button';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const value = payload.error;
    if (
      typeof value === 'object' &&
      value !== null &&
      'message' in value &&
      typeof value.message === 'string'
    ) {
      return value.message;
    }
  }
  return fallback;
}

function dateLabel(value?: string): string {
  if (!value) return 'Not synced yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function IntegrationsManager({
  organizationId,
  initialIntegrations,
}: {
  organizationId: string;
  initialIntegrations: GitHubIntegration[];
}) {
  const { notify, updateToast, confirm } = useFeedback();
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('main');
  const [path, setPath] = useState('README.md');
  const [accessToken, setAccessToken] = useState('');
  const [accessRoles, setAccessRoles] = useState<Array<'member' | 'viewer'>>(['member', 'viewer']);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Array<'member' | 'viewer'>>>({});

  function replaceIntegration(updated: GitHubIntegration) {
    setIntegrations((current) =>
      current.map((integration) => (integration.id === updated.id ? updated : integration)),
    );
    setRoleDrafts((current) => ({ ...current, [updated.id]: updated.accessRoles }));
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Connecting GitHub',
      description: 'Checking read access to the selected repository…',
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/integrations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ owner, repository, branch, path, accessToken, accessRoles }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response, 'Could not connect GitHub.'));
      const integration = GitHubIntegrationSchema.parse(await response.json());
      setIntegrations((current) => [integration, ...current]);
      setRoleDrafts((current) => ({ ...current, [integration.id]: integration.accessRoles }));
      setAccessToken('');
      updateToast(toastId, {
        kind: 'success',
        title: 'GitHub connected',
        description: 'The source is connected. Sync it to add its file to workspace knowledge.',
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not connect GitHub',
        description: cause instanceof Error ? cause.message : 'Check the repository and token.',
        persistent: false,
      });
    } finally {
      setSaving(false);
    }
  }

  async function sync(integration: GitHubIntegration) {
    setBusyId(integration.id);
    setIntegrations((current) =>
      current.map((item) => (item.id === integration.id ? { ...item, status: 'syncing' } : item)),
    );
    const toastId = notify({
      kind: 'loading',
      title: 'Syncing GitHub file',
      description: `${integration.owner}/${integration.repository}/${integration.path}`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/integrations/${encodeURIComponent(integration.id)}/sync`,
        { method: 'POST', credentials: 'include' },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not sync the GitHub file.'));
      const updated = GitHubIntegrationSchema.parse(await response.json());
      replaceIntegration(updated);
      updateToast(
        toastId,
        updated.status === 'error'
          ? {
              kind: 'error',
              title: 'GitHub sync failed',
              description: updated.errorMessage ?? 'Check the source details and try again.',
              persistent: false,
            }
          : {
              kind: 'success',
              title: 'GitHub source synced',
              description: 'The file was checked; any changed content was queued for indexing.',
              persistent: false,
            },
      );
    } catch (cause) {
      setIntegrations((current) =>
        current.map((item) =>
          item.id === integration.id
            ? {
                ...item,
                status: 'error',
                errorMessage: cause instanceof Error ? cause.message : 'Sync failed.',
              }
            : item,
        ),
      );
      updateToast(toastId, {
        kind: 'error',
        title: 'GitHub sync failed',
        description: cause instanceof Error ? cause.message : 'Try syncing again.',
        persistent: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  function draftRoles(integration: GitHubIntegration) {
    return roleDrafts[integration.id] ?? integration.accessRoles;
  }

  function toggleRole(integration: GitHubIntegration, role: 'member' | 'viewer') {
    const current = draftRoles(integration);
    setRoleDrafts((drafts) => ({
      ...drafts,
      [integration.id]: current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role],
    }));
  }

  async function saveRoles(integration: GitHubIntegration) {
    const roles = draftRoles(integration);
    const toastId = notify({
      kind: 'loading',
      title: 'Updating source access',
      description: 'Applying role access to this folder and its documents…',
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/integrations/${encodeURIComponent(integration.id)}/access`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accessRoles: roles }),
        },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not update source access.'));
      replaceIntegration(GitHubIntegrationSchema.parse(await response.json()));
      updateToast(toastId, {
        kind: 'success',
        title: 'Source access updated',
        description: 'The folder and its indexed chunks now use these workspace roles.',
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not update access',
        description: cause instanceof Error ? cause.message : 'Try again.',
        persistent: false,
      });
    }
  }

  async function remove(integration: GitHubIntegration) {
    const accepted = await confirm({
      title: 'Remove GitHub source?',
      message: `This disconnects ${integration.owner}/${integration.repository} and removes its imported document and indexed chunks from this workspace.`,
      confirmLabel: 'Remove source',
      danger: true,
    });
    if (!accepted) return;
    const toastId = notify({
      kind: 'loading',
      title: 'Removing GitHub source',
      description: 'Disconnecting and deleting its imported workspace document…',
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/integrations/${encodeURIComponent(integration.id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not remove the GitHub source.'));
      setIntegrations((current) => current.filter((item) => item.id !== integration.id));
      updateToast(toastId, {
        kind: 'success',
        title: 'GitHub source removed',
        description: 'The connector and its imported knowledge have been deleted.',
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not remove source',
        description: cause instanceof Error ? cause.message : 'Try again.',
        persistent: false,
      });
    }
  }

  async function refresh() {
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/integrations`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not refresh GitHub files.'));
      const { integrations: refreshed } = GitHubIntegrationsResponseSchema.parse(
        await response.json(),
      );
      setIntegrations(refreshed);
      setRoleDrafts(Object.fromEntries(refreshed.map((item) => [item.id, item.accessRoles])));
      notify({
        kind: 'success',
        title: 'GitHub files refreshed',
        description: `${refreshed.length} ${refreshed.length === 1 ? 'file' : 'files'} loaded.`,
      });
    } catch (cause) {
      notify({
        kind: 'error',
        title: 'Could not refresh GitHub files',
        description: cause instanceof Error ? cause.message : 'Try again.',
      });
    }
  }

  return (
    <div className="integration-manager integrations-layout">
      <section className="integration-card">
        <div className="integration-card-head">
          <div>
            <span className="integration-provider-mark" aria-hidden="true">
              GH
            </span>
            <h2>GitHub</h2>
          </div>
          <span className="integration-readonly-badge">Read-only</span>
        </div>
        <p className="integration-description">
          Import one Markdown or TXT file from a repository you can access. OrgMind indexes it like
          any uploaded document.
        </p>
        <form className="integration-form" onSubmit={(event) => void create(event)}>
          <label>
            Repository owner
            <input
              value={owner}
              onChange={(event) => setOwner(event.currentTarget.value)}
              required
              maxLength={100}
              placeholder="octocat"
            />
          </label>
          <label>
            Repository name
            <input
              value={repository}
              onChange={(event) => setRepository(event.currentTarget.value)}
              required
              maxLength={100}
              placeholder="team-handbook"
            />
          </label>
          <label>
            Branch
            <input
              value={branch}
              onChange={(event) => setBranch(event.currentTarget.value)}
              required
              maxLength={255}
              placeholder="main"
            />
          </label>
          <label>
            File path
            <input
              value={path}
              onChange={(event) => setPath(event.currentTarget.value)}
              required
              maxLength={500}
              placeholder="docs/handbook.md"
            />
          </label>
          <label className="integration-token-field">
            GitHub personal access token
            <input
              type="password"
              autoComplete="new-password"
              value={accessToken}
              onChange={(event) => setAccessToken(event.currentTarget.value)}
              required
              maxLength={500}
              placeholder="github_pat_…"
            />
            <small>Use a fine-grained token with read-only repository access.</small>
          </label>
          <fieldset className="integration-access-fieldset">
            <legend>Who can read the imported file?</legend>
            <label>
              <input
                type="checkbox"
                checked={accessRoles.includes('member')}
                onChange={() =>
                  setAccessRoles((roles) =>
                    roles.includes('member')
                      ? roles.filter((role) => role !== 'member')
                      : [...roles, 'member'],
                  )
                }
              />
              Members
            </label>
            <label>
              <input
                type="checkbox"
                checked={accessRoles.includes('viewer')}
                onChange={() =>
                  setAccessRoles((roles) =>
                    roles.includes('viewer')
                      ? roles.filter((role) => role !== 'viewer')
                      : [...roles, 'viewer'],
                  )
                }
              />
              Viewers
            </label>
            <small>Workspace admins always retain access. You can change these roles later.</small>
          </fieldset>
          <IntegrationButton type="submit" disabled={saving}>
            {saving ? 'Connecting…' : 'Connect GitHub'}
          </IntegrationButton>
        </form>
        <p className="integration-security-note">
          The token is encrypted and never shown again. Disconnecting removes the imported file and
          its indexed content.
        </p>
      </section>

      <section className="integration-card integration-list-card">
        <div className="integration-list-heading">
          <div>
            <h2>GitHub sources</h2>
            <p>Sync files and manage who can search them.</p>
          </div>
          <div className="integration-list-actions">
            <span>
              {integrations.length} {integrations.length === 1 ? 'source' : 'sources'}
            </span>
            <IntegrationButton variant="secondary" type="button" onClick={() => void refresh()}>
              Refresh
            </IntegrationButton>
          </div>
        </div>
        {integrations.length === 0 ? (
          <div className="integration-empty">
            <span aria-hidden="true">↔</span>
            <strong>No connected sources yet</strong>
            <p>Connect a GitHub file above to make its content searchable in this workspace.</p>
          </div>
        ) : (
          <div className="integration-source-list">
            {integrations.map((integration) => (
              <article className="integration-source" key={integration.id}>
                <header>
                  <div className="integration-source-title">
                    <span className="integration-provider-mark small" aria-hidden="true">
                      GH
                    </span>
                    <div>
                      <strong>
                        {integration.owner}/{integration.repository}
                      </strong>
                      <code>
                        {integration.branch}:{integration.path}
                      </code>
                    </div>
                  </div>
                  <span className={`integration-status is-${integration.status}`}>
                    <i aria-hidden="true" />
                    {integration.status === 'ready'
                      ? 'Synced'
                      : integration.status === 'syncing'
                        ? 'Syncing'
                        : integration.status === 'error'
                          ? 'Needs attention'
                          : 'Connected'}
                  </span>
                </header>
                <div className="integration-source-meta">
                  <span>Last sync: {dateLabel(integration.lastSyncedAt)}</span>
                  {integration.documentId && (
                    <a href={`/knowledge/${encodeURIComponent(integration.documentId)}`}>
                      Open imported document
                    </a>
                  )}
                </div>
                {integration.errorMessage && (
                  <p className="integration-error-message">{integration.errorMessage}</p>
                )}
                <fieldset className="integration-role-editor">
                  <legend>Document access</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={draftRoles(integration).includes('member')}
                      onChange={() => toggleRole(integration, 'member')}
                    />
                    Members
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draftRoles(integration).includes('viewer')}
                      onChange={() => toggleRole(integration, 'viewer')}
                    />
                    Viewers
                  </label>
                  <span>Admins always have access.</span>
                  <IntegrationButton
                    variant="secondary"
                    type="button"
                    disabled={
                      JSON.stringify(draftRoles(integration).sort()) ===
                        JSON.stringify([...integration.accessRoles].sort()) ||
                      busyId === integration.id
                    }
                    onClick={() => void saveRoles(integration)}
                  >
                    Save access
                  </IntegrationButton>
                </fieldset>
                <footer>
                  <IntegrationButton
                    type="button"
                    disabled={busyId === integration.id}
                    onClick={() => void sync(integration)}
                  >
                    {busyId === integration.id
                      ? 'Syncing…'
                      : integration.documentId
                        ? 'Sync now'
                        : 'Sync file'}
                  </IntegrationButton>
                  <IntegrationButton
                    variant="danger"
                    type="button"
                    disabled={busyId === integration.id}
                    onClick={() => void remove(integration)}
                  >
                    Disconnect
                  </IntegrationButton>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
