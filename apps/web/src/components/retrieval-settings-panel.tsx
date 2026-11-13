'use client';

import { useState } from 'react';
import { RetrievalSettingsResponseSchema, type RetrievalSettingsResponse } from '@orgmind/shared';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export function RetrievalSettingsPanel({
  organizationId,
  initialSettings,
}: {
  organizationId: string;
  initialSettings: RetrievalSettingsResponse;
}) {
  const { notify, updateToast } = useFeedback();
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);

  async function update(
    next: Pick<RetrievalSettingsResponse, 'rerankingEnabled' | 'queryRewriteEnabled'>,
  ) {
    setSaving(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Saving retrieval settings',
      description: 'Applying your assistant search preferences…',
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/retrieval-settings`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            rerankingEnabled: next.rerankingEnabled,
            queryRewriteEnabled: next.queryRewriteEnabled,
          }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'object' &&
          payload.error !== null &&
          'message' in payload.error &&
          typeof payload.error.message === 'string'
            ? payload.error.message
            : 'Could not save retrieval settings.';
        throw new Error(message);
      }
      setSettings(RetrievalSettingsResponseSchema.parse(payload));
      updateToast(toastId, {
        kind: 'success',
        title: 'Retrieval settings saved',
        description: 'Your assistant will use these settings on the next question.',
        persistent: false,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save retrieval settings.';
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not save settings',
        description: message,
        persistent: false,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="members-card retrieval-settings-card">
      <div className="members-card-head">
        <strong>Retrieval settings</strong>
        <span>Admin controls</span>
      </div>
      <div className="retrieval-setting-row">
        <div>
          <strong>Rerank search results</strong>
          <p>
            Score the top retrieved passages with Cohere before building the answer context.
            {!settings.rerankerAvailable && ' Add COHERE_API_KEY to enable this option.'}
          </p>
        </div>
        <input
          aria-label="Enable reranking"
          type="checkbox"
          checked={settings.rerankingEnabled}
          disabled={saving || !settings.rerankerAvailable}
          onChange={(event) =>
            void update({ ...settings, rerankingEnabled: event.currentTarget.checked })
          }
        />
      </div>
      <div className="retrieval-setting-row">
        <div>
          <strong>Rewrite search queries</strong>
          <p>Use the configured chat model to turn each question into a focused search query.</p>
        </div>
        <input
          aria-label="Enable query rewriting"
          type="checkbox"
          checked={settings.queryRewriteEnabled}
          disabled={saving}
          onChange={(event) =>
            void update({ ...settings, queryRewriteEnabled: event.currentTarget.checked })
          }
        />
      </div>
      {saving && (
        <p className="retrieval-settings-status" role="status">
          Saving…
        </p>
      )}
    </section>
  );
}
