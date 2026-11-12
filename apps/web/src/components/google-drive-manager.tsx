'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  GoogleDriveIntegrationSchema,
  GoogleDriveIntegrationsResponseSchema,
  type GoogleDriveIntegration,
} from '@orgmind/shared';
import { useFeedback } from './feedback-provider';
import { IntegrationButton } from './integration-button';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = payload.error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
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

export function GoogleDriveManager({
  organizationId,
  initialIntegrations,
}: {
  organizationId: string;
  initialIntegrations: GoogleDriveIntegration[];
}) {
  const { notify, updateToast, confirm } = useFeedback();
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [fileUrl, setFileUrl] = useState('');
  const [accessRoles, setAccessRoles] = useState<Array<'member' | 'viewer'>>(['member', 'viewer']);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Array<'member' | 'viewer'>>>({});
  const endpoint = `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/integrations/google-drive`;

  function replaceIntegration(updated: GoogleDriveIntegration) {
    setIntegrations((current) =>
      current.map((integration) => (integration.id === updated.id ? updated : integration)),
    );
    setRoleDrafts((current) => ({ ...current, [updated.id]: updated.accessRoles }));
  }

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const result = currentUrl.searchParams.get('googleDrive');
    if (result === 'connected') {
      notify({
        kind: 'success',
        title: 'Google Drive connected',
        description: 'The selected PDF or document is queued for indexing.',
      });
    } else if (result === 'error') {
      notify({
        kind: 'error',
        title: 'Google Drive connection failed',
        description: 'Check the file access and Google OAuth setup, then try again.',
      });
    }
    if (result === 'connected' || result === 'error') {
      currentUrl.searchParams.delete('googleDrive');
      window.history.replaceState(
        null,
        '',
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }
  }, [notify]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Preparing Google Drive',
      description: 'Opening Google’s secure authorization page…',
    });
    try {
      const response = await fetch(`${endpoint}/authorize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileUrl, accessRoles }),
      });
      if (!response.ok)
        throw new Error(
          await errorMessage(response, 'Could not start Google Drive authorization.'),
        );
      const payload: unknown = await response.json();
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('authorizationUrl' in payload) ||
        typeof payload.authorizationUrl !== 'string'
      ) {
        throw new Error('The API returned an invalid Google authorization link.');
      }
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not connect Google Drive',
        description: error instanceof Error ? error.message : 'Check the file link and try again.',
        persistent: false,
      });
    } finally {
      setConnecting(false);
    }
  }

  async function sync(integration: GoogleDriveIntegration) {
    setBusyId(integration.id);
    const toastId = notify({
      kind: 'loading',
      title: 'Syncing Google Drive file',
      description: integration.fileName,
      persistent: true,
    });
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(integration.id)}/sync`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not sync this Google Drive file.'));
      const updated = GoogleDriveIntegrationSchema.parse(await response.json());
      replaceIntegration(updated);
      updateToast(
        toastId,
        updated.status === 'error'
          ? {
              kind: 'error',
              title: 'Google Drive sync failed',
              description: updated.errorMessage ?? 'Reconnect the Google account and try again.',
              persistent: false,
            }
          : {
              kind: 'success',
              title: 'Google Drive file synced',
              description: 'Changed content was queued for indexing.',
              persistent: false,
            },
      );
    } catch (error) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Google Drive sync failed',
        description: error instanceof Error ? error.message : 'Try again.',
        persistent: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  async function saveRoles(integration: GoogleDriveIntegration) {
    const roles = roleDrafts[integration.id] ?? integration.accessRoles;
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(integration.id)}/access`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessRoles: roles }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not update file access.'));
      replaceIntegration(GoogleDriveIntegrationSchema.parse(await response.json()));
      notify({
        kind: 'success',
        title: 'Drive file access updated',
        description: 'Workspace access is now up to date.',
      });
    } catch (error) {
      notify({
        kind: 'error',
        title: 'Could not update access',
        description: error instanceof Error ? error.message : 'Try again.',
      });
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Could not refresh Google Drive files.'));
      const { integrations: refreshed } = GoogleDriveIntegrationsResponseSchema.parse(
        await response.json(),
      );
      setIntegrations(refreshed);
      setRoleDrafts(Object.fromEntries(refreshed.map((item) => [item.id, item.accessRoles])));
      notify({
        kind: 'success',
        title: 'Google Drive files refreshed',
        description: `${refreshed.length} ${refreshed.length === 1 ? 'file' : 'files'} loaded.`,
      });
    } catch (error) {
      notify({
        kind: 'error',
        title: 'Could not refresh Google Drive files',
        description: error instanceof Error ? error.message : 'Try again.',
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function remove(integration: GoogleDriveIntegration) {
    if (
      !(await confirm({
        title: 'Remove Google Drive source?',
        message: `Disconnect ${integration.fileName} and delete its imported document and indexed chunks from this workspace?`,
        confirmLabel: 'Remove source',
        danger: true,
      }))
    )
      return;
    const response = await fetch(`${endpoint}/${encodeURIComponent(integration.id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      notify({
        kind: 'error',
        title: 'Could not remove source',
        description: await errorMessage(response, 'Try again.'),
      });
      return;
    }
    setIntegrations((current) => current.filter((item) => item.id !== integration.id));
    notify({
      kind: 'success',
      title: 'Google Drive source removed',
      description: 'Its imported document and indexed chunks were deleted.',
    });
  }

  return (
    <div className="integration-manager google-drive-manager">
      <section className="integration-card google-drive-card">
        <div className="integration-card-head">
          <div>
            <span className="integration-provider-mark" aria-hidden="true">
              G
            </span>
            <h2>Google Drive</h2>
          </div>
          <span className="integration-readonly-badge">Read-only</span>
        </div>
        <p className="integration-description">
          Import one PDF, DOCX, or Google Docs file. Google Docs are converted to DOCX before
          indexing.
        </p>
        <form
          className="integration-form google-drive-form"
          onSubmit={(event) => void connect(event)}
        >
          <label className="drive-file-url-field">
            Google Drive file URL or ID
            <input
              value={fileUrl}
              onChange={(event) => setFileUrl(event.currentTarget.value)}
              required
              maxLength={2000}
              placeholder="Paste a Google Drive file link"
            />
            <small>
              The Google account you authorize must be able to open the file. Folders, Sheets, and
              Slides are not supported.
            </small>
          </label>
          <fieldset className="integration-access-fieldset">
            <legend>Who can search the imported file?</legend>
            {(['member', 'viewer'] as const).map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={accessRoles.includes(role)}
                  onChange={() =>
                    setAccessRoles((current) =>
                      current.includes(role)
                        ? current.filter((item) => item !== role)
                        : [...current, role],
                    )
                  }
                />
                {role === 'member' ? 'Members' : 'Viewers'}
              </label>
            ))}
            <small>Admins always retain access. You can change these roles later.</small>
          </fieldset>
          <IntegrationButton type="submit" disabled={connecting}>
            {connecting ? 'Opening Google…' : 'Connect Drive file'}
          </IntegrationButton>
        </form>
        <p className="integration-security-note">
          Access is read-only. The Google refresh token is encrypted and never shown again.
        </p>
      </section>

      <section className="integration-card drive-connected-list">
        <div className="integration-list-heading">
          <div>
            <h2>Google Drive files</h2>
            <p>Sync changes and manage who can search each file.</p>
          </div>
          <div className="integration-list-actions">
            <span>
              {integrations.length} {integrations.length === 1 ? 'file' : 'files'}
            </span>
            <IntegrationButton
              variant="secondary"
              type="button"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </IntegrationButton>
          </div>
        </div>
        {integrations.length === 0 ? (
          <div className="integration-empty">
            <strong>No Drive files connected</strong>
            <p>Connect an individual PDF or document above to make it searchable.</p>
          </div>
        ) : (
          <div className="integration-source-list">
            {integrations.map((integration) => (
              <article className="integration-source" key={integration.id}>
                <header>
                  <div className="integration-source-title">
                    <span className="integration-provider-mark small" aria-hidden="true">
                      G
                    </span>
                    <div>
                      <strong>{integration.fileName}</strong>
                      <code>
                        {integration.mimeType === 'application/pdf' ? 'PDF file' : 'DOCX document'}
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
                  {(['member', 'viewer'] as const).map((role) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={(roleDrafts[integration.id] ?? integration.accessRoles).includes(
                          role,
                        )}
                        onChange={() =>
                          setRoleDrafts((drafts) => {
                            const current = drafts[integration.id] ?? integration.accessRoles;
                            return {
                              ...drafts,
                              [integration.id]: current.includes(role)
                                ? current.filter((item) => item !== role)
                                : [...current, role],
                            };
                          })
                        }
                      />
                      {role === 'member' ? 'Members' : 'Viewers'}
                    </label>
                  ))}
                  <IntegrationButton
                    variant="secondary"
                    type="button"
                    disabled={
                      JSON.stringify(
                        [...(roleDrafts[integration.id] ?? integration.accessRoles)].sort(),
                      ) === JSON.stringify([...integration.accessRoles].sort()) ||
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
                    {busyId === integration.id ? 'Syncing…' : 'Sync now'}
                  </IntegrationButton>
                  <IntegrationButton
                    variant="danger"
                    type="button"
                    onClick={() => void remove(integration)}
                  >
                    Remove
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
