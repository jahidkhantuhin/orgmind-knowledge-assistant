import { OrganizationDocumentsResponseSchema, type DocumentSummary } from '@orgmind/shared';
import type { ToastUpdater } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

function progressFor(document: DocumentSummary) {
  if (document.progress !== undefined) return document.progress;
  if (document.status === 'parsed') return 100;
  if (document.status === 'embedding') return 10;
  if (document.status === 'chunking') return 5;
  if (document.status === 'parsing') return 1;
  return 0;
}

function stageFor(document: DocumentSummary) {
  switch (document.status) {
    case 'uploaded':
      return 'Waiting in the processing queue';
    case 'parsing':
      return 'Reading the document';
    case 'chunking':
      return 'Splitting it into sections';
    case 'embedding':
      return 'Creating searchable embeddings';
    case 'parsed':
      return 'Ready to search';
    case 'failed':
      return 'Processing failed';
  }
}

export function watchDocumentProcessing(
  organizationId: string,
  documentId: string,
  filename: string,
  toastId: string,
  updateToast: ToastUpdater,
) {
  void (async () => {
    let failedRequests = 0;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
      try {
        const response = await fetch(
          `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/documents`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (!response.ok) throw new Error('Status is temporarily unavailable.');
        const result = OrganizationDocumentsResponseSchema.parse(await response.json());
        const document = result.documents.find((item) => item.id === documentId);
        if (!document) {
          updateToast(toastId, {
            kind: 'info',
            title: 'Document processing stopped',
            description: `${filename} is no longer available in this workspace.`,
            persistent: false,
          });
          return;
        }
        failedRequests = 0;
        if (document.status === 'parsed') {
          updateToast(toastId, {
            kind: 'success',
            title: 'Document ready',
            description: `${filename} is searchable now.`,
            persistent: false,
            progress: 100,
          });
          return;
        }
        if (document.status === 'failed') {
          updateToast(toastId, {
            kind: 'error',
            title: 'Document processing failed',
            description:
              document.failureReason ??
              `${filename} could not be processed. You can retry from its details page.`,
            persistent: false,
          });
          return;
        }
        updateToast(toastId, {
          kind: 'loading',
          title: 'Processing your document',
          description: `${filename} · ${stageFor(document)} · ${progressFor(document)}%`,
          persistent: true,
          progress: progressFor(document),
        });
      } catch {
        failedRequests += 1;
        if (failedRequests >= 8) {
          updateToast(toastId, {
            kind: 'info',
            title: 'Document is still processing',
            description: `Check the Knowledge base for the latest status of ${filename}.`,
            persistent: false,
          });
          return;
        }
      }
    }
    updateToast(toastId, {
      kind: 'info',
      title: 'Document is still processing',
      description: `You can keep working. Check the Knowledge base for ${filename}’s status.`,
      persistent: false,
    });
  })();
}
