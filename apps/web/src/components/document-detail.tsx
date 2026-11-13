'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  DocumentChunksPageResponseSchema,
  DocumentDetailResponseSchema,
  DocumentSummarySchema,
  type DocumentDetailResponse,
  type DocumentSummary,
  type MembershipRole,
} from '@orgmind/shared';
import { WorkspaceNavigation } from './workspace-navigation';
import { useFeedback } from './feedback-provider';
import { watchDocumentProcessing } from './document-processing';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

function labelForStatus(status: DocumentSummary['status']): string {
  switch (status) {
    case 'uploaded':
      return 'Queued';
    case 'parsing':
      return 'Reading document';
    case 'chunking':
      return 'Splitting into sections';
    case 'embedding':
      return 'Creating embeddings';
    case 'parsed':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

function displayProgress(document: DocumentSummary): number {
  if (document.progress !== undefined) return document.progress;
  if (document.status === 'parsed') return 100;
  if (document.status === 'embedding') return 10;
  if (document.status === 'chunking') return 5;
  if (document.status === 'parsing') return 1;
  return 0;
}

export function DocumentDetail({
  detail: initialDetail,
  organizationId,
  organizationName,
  role,
}: {
  detail: DocumentDetailResponse;
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
}) {
  const router = useRouter();
  const { confirm, notify, updateToast } = useFeedback();
  const [detail, setDetail] = useState(initialDetail);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chunkError, setChunkError] = useState('');
  const canManage = role === 'admin' || role === 'member';
  const document = detail.document;
  const inProgress = ['uploaded', 'parsing', 'chunking', 'embedding'].includes(document.status);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents/${encodeURIComponent(document.id)}`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!response.ok) return;
    const updated = DocumentDetailResponseSchema.parse(await response.json());
    setDetail((current) => {
      // A completed reprocess replaces all chunks; routine status polling keeps loaded pages.
      if (current.document.status !== 'parsed' && updated.document.status === 'parsed') {
        return updated;
      }
      const chunksById = new Map(updated.chunks.map((chunk) => [chunk._id, chunk]));
      for (const chunk of current.chunks) chunksById.set(chunk._id, chunk);
      return {
        ...updated,
        chunks: [...chunksById.values()].sort((a, b) => a.chunkIndex - b.chunkIndex),
      };
    });
  }, [document.id, organizationId]);

  async function loadMoreChunks() {
    const cursor = detail.chunks.at(-1)?.chunkIndex;
    if (cursor === undefined) return;
    setLoadingMore(true);
    setChunkError('');
    try {
      const query = new URLSearchParams({ afterChunkIndex: String(cursor) });
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents/${encodeURIComponent(document.id)}/chunks?${query}`,
        { credentials: 'include', cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Could not load more chunks. Please try again.');
      const page = DocumentChunksPageResponseSchema.parse(await response.json());
      setDetail((current) => {
        const chunksById = new Map(current.chunks.map((chunk) => [chunk._id, chunk]));
        for (const chunk of page.chunks) chunksById.set(chunk._id, chunk);
        return {
          ...current,
          chunks: [...chunksById.values()].sort((a, b) => a.chunkIndex - b.chunkIndex),
        };
      });
    } catch (cause) {
      setChunkError(cause instanceof Error ? cause.message : 'Could not load more chunks.');
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!inProgress) return;
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(interval);
  }, [inProgress, refresh]);

  async function reingest() {
    setBusy(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Reprocessing document',
      description: `Preparing ${document.originalName}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents/${encodeURIComponent(document.id)}/reingest`,
        { method: 'POST', credentials: 'include' },
      );
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error('Could not queue this document for reprocessing.');
      if (typeof payload !== 'object' || payload === null || !('document' in payload)) {
        throw new Error('The API returned an invalid document response.');
      }
      const updated = DocumentSummarySchema.parse(payload.document);
      setDetail((current) => ({ ...current, document: updated }));
      updateToast(toastId, {
        kind: 'loading',
        title: 'Reprocessing document',
        description: `${document.originalName} · Existing content stays searchable while the new version is prepared.`,
        persistent: true,
        progress: updated.progress ?? 0,
      });
      watchDocumentProcessing(
        organizationId,
        document.id,
        document.originalName,
        toastId,
        updateToast,
      );
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not reprocess document',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument() {
    if (
      !(await confirm({
        title: `Delete “${document.originalName}”?`,
        message: `This permanently removes the document and its ${document.chunkCount ?? 0} searchable sections from the workspace.`,
        confirmLabel: 'Delete document',
      }))
    )
      return;
    setBusy(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Deleting document',
      description: `Removing ${document.originalName}…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents/${encodeURIComponent(document.id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok) throw new Error('Could not delete this document. Please try again.');
      updateToast(toastId, {
        kind: 'success',
        title: 'Document deleted',
        description: `${document.originalName} was removed from the workspace.`,
        persistent: false,
      });
      router.push('/knowledge');
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not delete document',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
      setBusy(false);
    }
  }

  return (
    <main className="knowledge-page document-detail-page">
      <WorkspaceNavigation active="knowledge" role={role} />
      <section className="knowledge-content">
        <p className="eyebrow">{organizationName.toUpperCase()}</p>
        <div className="detail-heading-row">
          <div>
            <div className="detail-breadcrumb">
              <Link href="/knowledge">Knowledge base</Link>
              <span>/</span>
              {document.originalName}
            </div>
            <h1>{document.originalName}</h1>
            <p className="detail-subtitle">
              {document.extension.toUpperCase()} · {(document.sizeBytes / 1024).toFixed(0)} KB
            </p>
          </div>
          <div className="detail-actions">
            <span className={`document-status status-${document.status}`}>
              {labelForStatus(document.status)}
            </span>
            {inProgress && (
              <div className="document-progress detail-progress">
                <div className="document-progress-label">
                  <span>{displayProgress(document)}%</span>
                </div>
                <div
                  className="document-progress-track"
                  role="progressbar"
                  aria-label={`Processing ${document.originalName}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={displayProgress(document)}
                >
                  <span style={{ width: `${displayProgress(document)}%` }} />
                </div>
              </div>
            )}
            {canManage && !inProgress && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void reingest()}
                disabled={busy}
              >
                Reprocess
              </button>
            )}
            {canManage && (
              <button
                className="danger-button"
                type="button"
                onClick={() => void deleteDocument()}
                disabled={busy}
              >
                Delete
              </button>
            )}
          </div>
        </div>
        {document.failureReason && (
          <p className="knowledge-message error" role="alert">
            {document.failureReason}
          </p>
        )}
        <section className="documents-card chunk-section" aria-label="Document chunks">
          <div className="documents-card-heading">
            <div>
              <h2>Document chunks</h2>
              <p>Structure-aware sections with heading and table context.</p>
            </div>
            <span>{document.chunkCount ?? detail.chunks.length} total</span>
          </div>
          {detail.chunks.length === 0 ? (
            <div className="documents-empty">
              <div className="empty-file-icon">▤</div>
              <strong>{inProgress ? 'Preparing document chunks' : 'No chunks yet'}</strong>
              <p>
                {inProgress
                  ? 'This page updates as processing finishes.'
                  : 'Reprocess this document to create searchable chunks.'}
              </p>
            </div>
          ) : (
            <div className="chunk-list">
              {detail.chunks.map((chunk) => (
                <article className="chunk-preview" key={chunk._id}>
                  <header>
                    <strong>Chunk {chunk.chunkIndex + 1}</strong>
                    <span>{chunk.endOffset - chunk.startOffset} source characters</span>
                  </header>
                  {chunk.headingPath.length > 0 && (
                    <p className="chunk-heading-path">{chunk.headingPath.join(' / ')}</p>
                  )}
                  <p className="chunk-text">{chunk.text}</p>
                </article>
              ))}
              {(document.chunkCount ?? 0) > detail.chunks.length && (
                <div className="chunk-more">
                  <p>
                    Showing {detail.chunks.length} of {document.chunkCount} chunks.
                  </p>
                  {chunkError && (
                    <p className="chunk-load-error" role="alert">
                      {chunkError}
                    </p>
                  )}
                  <button
                    className="secondary-button chunk-load-more"
                    type="button"
                    onClick={() => void loadMoreChunks()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
