'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  OrganizationDocumentsResponseSchema,
  DocumentSummarySchema,
  type DocumentSummary,
  type MembershipRole,
} from '@orgmind/shared';
import { WorkspaceNavigation } from './workspace-navigation';
import { CollectionShareControl } from './collection-share-control';
import { useFeedback } from './feedback-provider';
import { watchDocumentProcessing } from './document-processing';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: DocumentSummary['status']): string {
  switch (status) {
    case 'uploaded':
      return 'Queued';
    case 'parsing':
      return 'Processing';
    case 'chunking':
      return 'Chunking';
    case 'embedding':
      return 'Embedding';
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

export function KnowledgeBase({
  organizationId,
  organizationName,
  role,
}: {
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
}) {
  const { confirm, notify, updateToast } = useFeedback();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [collectionName, setCollectionName] = useState('default');
  const inputRef = useRef<HTMLInputElement>(null);
  const canManage = role === 'admin' || role === 'member';

  const refreshDocuments = useCallback(async () => {
    const response = await fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!response.ok) throw new Error('Unable to load documents. Please refresh the page.');
    const result = OrganizationDocumentsResponseSchema.parse(await response.json());
    setDocuments(result.documents);
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (!response.ok) throw new Error('Unable to load documents. Please refresh the page.');
        const result = OrganizationDocumentsResponseSchema.parse(await response.json());
        if (active) setDocuments(result.documents);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load documents.');
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [organizationId]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    setBusy(true);
    const toastId = notify({
      kind: 'loading',
      title: 'Uploading document',
      description: `${file.name} · Preparing upload…`,
    });
    try {
      const form = new FormData();
      form.append('file', file);
      form.append(
        'collectionId',
        collectionName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-') || 'default',
      );
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents`,
        { method: 'POST', credentials: 'include', body: form },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload.error as { message?: string }).message
            : undefined;
        throw new Error(message ?? 'Upload failed. Please try again.');
      }
      const uploadPayload = payload as { document?: unknown };
      const uploadedDocument = DocumentSummarySchema.parse(uploadPayload.document);
      updateToast(toastId, {
        kind: 'loading',
        title: 'Processing your document',
        description: `${file.name} · Added to the processing queue`,
        persistent: true,
        progress: uploadedDocument.progress ?? 0,
      });
      watchDocumentProcessing(organizationId, uploadedDocument.id, file.name, toastId, updateToast);
      try {
        await refreshDocuments();
      } catch {
        notify({
          kind: 'info',
          title: 'Upload accepted',
          description: 'The document is processing. Refresh the Knowledge base to see its row.',
        });
      }
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Upload failed',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function removeDocument(document: DocumentSummary) {
    if (
      !(await confirm({
        title: `Delete “${document.originalName}”?`,
        message:
          'This permanently removes the document and its searchable content from the workspace.',
        confirmLabel: 'Delete document',
      }))
    )
      return;
    setDeletingId(document.id);
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
      if (!response.ok) throw new Error('Unable to delete this document. Please try again.');
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      updateToast(toastId, {
        kind: 'success',
        title: 'Document deleted',
        description: `${document.originalName} was removed from the workspace.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not delete document',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    } finally {
      setDeletingId('');
    }
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    void upload(event.currentTarget.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  }

  return (
    <main className="knowledge-page">
      <WorkspaceNavigation active="knowledge" role={role} />
      <section className="knowledge-content">
        <p className="eyebrow">{organizationName.toUpperCase()}</p>
        <div className="knowledge-heading">
          <div>
            <h1>Knowledge base</h1>
            <p>Bring your team&apos;s documents together in one searchable workspace.</p>
          </div>
          <span className="date-chip">
            {documents.length} {documents.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
          </span>
        </div>

        {canManage && (
          <div
            className={`upload-dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={onDrop}
          >
            <div className="upload-icon">↑</div>
            <h2>{busy ? 'Uploading your document…' : 'Drop a document to add it'}</h2>
            <p>PDF, DOCX, Markdown, or TXT · up to 10 MB</p>
            <label className="folder-input-label" htmlFor="upload-folder">
              Folder
            </label>
            <input
              className="folder-input"
              id="upload-folder"
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              maxLength={80}
              placeholder="default"
            />
            <button
              className="primary-button"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Browse files
            </button>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
              onChange={onFileInput}
            />
          </div>
        )}

        {error && (
          <p className="knowledge-message error" role="alert">
            {error}
          </p>
        )}

        <section className="documents-card" aria-label="Documents">
          <div className="documents-card-heading">
            <div>
              <h2>Documents</h2>
              <p>Upload and processing status updates automatically.</p>
            </div>
            <span>{documents.length} total</span>
          </div>
          {documents.length === 0 ? (
            <div className="documents-empty">
              <div className="empty-file-icon">▤</div>
              <strong>No documents yet</strong>
              <p>Upload a team document to get your knowledge base started.</p>
            </div>
          ) : (
            <div className="document-table-wrap">
              <table className="document-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Size</th>
                    <th>Added</th>
                    <th>Status</th>
                    <th>Folder</th>
                    {canManage && (
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id}>
                      <td>
                        <div className="document-name">
                          <span className="document-file-icon">
                            {document.extension.toUpperCase()}
                          </span>
                          <div>
                            <Link
                              className="document-open"
                              href={`/knowledge/${encodeURIComponent(document.id)}`}
                            >
                              {document.originalName}
                            </Link>
                            <small>Workspace document</small>
                          </div>
                        </div>
                      </td>
                      <td>{formatSize(document.sizeBytes)}</td>
                      <td>{new Date(document.createdAt).toLocaleDateString()}</td>
                      <td>
                        {['uploaded', 'parsing', 'chunking', 'embedding'].includes(
                          document.status,
                        ) ? (
                          <div className="document-progress">
                            <div className="document-progress-label">
                              <span className={`document-status status-${document.status}`}>
                                {statusLabel(document.status)}
                              </span>
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
                        ) : (
                          <span
                            className={`document-status status-${document.status}`}
                            title={document.failureReason}
                          >
                            {statusLabel(document.status)}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="folder-pill">{document.collectionId}</span>
                      </td>
                      {canManage && (
                        <td>
                          {role === 'admin' && (
                            <CollectionShareControl
                              organizationId={organizationId}
                              collectionId={document.collectionId}
                              documentId={document.id}
                              documentName={document.originalName}
                              acl={document.acl}
                            />
                          )}
                          <button
                            className="document-delete"
                            type="button"
                            onClick={() => void removeDocument(document)}
                            disabled={deletingId === document.id}
                            aria-label={`Delete ${document.originalName}`}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
