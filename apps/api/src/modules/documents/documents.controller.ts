import type { Request, RequestHandler } from 'express';
import {
  DocumentChunksPageResponseSchema,
  DocumentCollectionAccessResponseSchema,
  DocumentSummarySchema,
  OrganizationDocumentsResponseSchema,
  UpdateDocumentAccessSchema,
  UpdateAccessGrantsSchema,
} from '@orgmind/shared';
import { extensionForFilename } from './document-storage.js';
import { documentsService } from './documents.service.js';
import { aclTokensForPrincipal } from './document-acl.js';
import { groupsRepository } from '../organizations/groups.repository.js';
import { membershipsRepository } from '../organizations/memberships.repository.js';

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const listDocumentsController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  if (!organizationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Organization is required.' } });
    return;
  }
  const documents = await documentsService.list(organizationId, aclTokensForRequest(req));
  res.json(
    OrganizationDocumentsResponseSchema.parse({
      documents:
        req.membership?.role === 'admin'
          ? documents
          : documents.map((document) => ({ ...document, acl: [] })),
    }),
  );
};

export const getDocumentDetailController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const documentId = routeParam(req.params.documentId);
  if (!organizationId || !documentId) {
    res.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Document is required.' } });
    return;
  }
  const detail = await documentsService.getDetail(
    organizationId,
    documentId,
    aclTokensForRequest(req),
  );
  if (!detail) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }
  res.json(
    req.membership?.role === 'admin'
      ? detail
      : { ...detail, document: { ...detail.document, acl: [] } },
  );
};

export const listDocumentChunksController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const documentId = routeParam(req.params.documentId);
  const rawCursor = req.query.afterChunkIndex;
  const cursor = typeof rawCursor === 'string' ? Number(rawCursor) : Number.NaN;
  if (!organizationId || !documentId || !Number.isSafeInteger(cursor) || cursor < 0) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_CURSOR', message: 'A valid chunk cursor is required.' } });
    return;
  }
  const page = await documentsService.listChunkPreviews(
    organizationId,
    documentId,
    cursor,
    aclTokensForRequest(req),
  );
  if (!page) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }
  res.json(DocumentChunksPageResponseSchema.parse(page));
};

export const uploadDocumentController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const userId = req.authSession?.user.id;
  const file = req.file;
  if (!organizationId || !userId) {
    res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
    return;
  }
  if (!file) {
    res
      .status(400)
      .json({ error: { code: 'FILE_REQUIRED', message: 'Choose one document to upload.' } });
    return;
  }
  const extension = extensionForFilename(file.originalname);
  if (!extension) {
    res
      .status(415)
      .json({ error: { code: 'UNSUPPORTED_FILE_TYPE', message: 'Unsupported file type.' } });
    return;
  }
  const rawCollectionId = req.body?.collectionId;
  const collectionId =
    typeof rawCollectionId === 'string'
      ? rawCollectionId
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
      : 'default';
  const document = DocumentSummarySchema.parse(
    await documentsService.upload(
      organizationId,
      userId,
      file,
      extension,
      collectionId || 'default',
      aclTokensForRequest(req),
    ),
  );
  res.status(202).json({ document: safeSummaryForRole(document, req) });
};

export const deleteDocumentController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const documentId = routeParam(req.params.documentId);
  if (!organizationId || !documentId) {
    res.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Document is required.' } });
    return;
  }
  const deleted = await documentsService.delete(
    organizationId,
    documentId,
    aclTokensForRequest(req),
  );
  if (!deleted) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }
  res.status(204).end();
};

export const reingestDocumentController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const documentId = routeParam(req.params.documentId);
  if (!organizationId || !documentId) {
    res.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Document is required.' } });
    return;
  }
  const document = await documentsService.reingest(
    organizationId,
    documentId,
    aclTokensForRequest(req),
  );
  if (!document) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }
  res.status(202).json({ document: safeSummaryForRole(document, req) });
};

export const updateCollectionAccessController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const collectionId = routeParam(req.params.collectionId);
  const input = UpdateDocumentAccessSchema.safeParse(req.body);
  if (
    !organizationId ||
    !collectionId ||
    !input.success ||
    input.data.collectionId !== collectionId
  ) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ACCESS', message: 'Choose valid sharing settings.' } });
    return;
  }
  const groupIds = [...new Set(input.data.groupIds)];
  const existingGroups = await groupsRepository.findIds(organizationId, groupIds);
  const userIds = [...new Set(input.data.userIds)];
  const existingUsers = await membershipsRepository.findUserIdsInOrganization(
    organizationId,
    userIds,
  );
  if (existingGroups.length !== groupIds.length || existingUsers.length !== userIds.length) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_GROUPS', message: 'A selected team group is invalid.' } });
    return;
  }
  const updated = await documentsService.shareCollection(organizationId, collectionId, {
    roles: input.data.roles,
    userIds,
    groupIds,
  });
  if (!updated) {
    res.status(404).json({ error: { code: 'COLLECTION_NOT_FOUND', message: 'Folder not found.' } });
    return;
  }
  res.status(204).end();
};

export const getCollectionAccessController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const collectionId = routeParam(req.params.collectionId);
  if (!organizationId || !collectionId) {
    res.status(400).json({ error: { code: 'INVALID_COLLECTION', message: 'Folder is required.' } });
    return;
  }
  const acl = await documentsService.getCollectionAccess(organizationId, collectionId);
  if (!acl) {
    res.status(404).json({ error: { code: 'COLLECTION_NOT_FOUND', message: 'Folder not found.' } });
    return;
  }
  res.json(DocumentCollectionAccessResponseSchema.parse({ acl }));
};

export const updateDocumentAccessController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const documentId = routeParam(req.params.documentId);
  const input = UpdateAccessGrantsSchema.safeParse(req.body);
  if (!organizationId || !documentId || !input.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ACCESS', message: 'Choose valid sharing settings.' } });
    return;
  }
  const groupIds = [...new Set(input.data.groupIds)];
  const userIds = [...new Set(input.data.userIds)];
  const [existingGroups, existingUsers] = await Promise.all([
    groupsRepository.findIds(organizationId, groupIds),
    membershipsRepository.findUserIdsInOrganization(organizationId, userIds),
  ]);
  if (existingGroups.length !== groupIds.length || existingUsers.length !== userIds.length) {
    res.status(400).json({
      error: { code: 'INVALID_ACCESS_TARGET', message: 'A selected person or group is invalid.' },
    });
    return;
  }
  const updated = await documentsService.shareDocument(organizationId, documentId, {
    roles: input.data.roles,
    userIds,
    groupIds,
  });
  if (!updated) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
    return;
  }
  res.status(204).end();
};

function aclTokensForRequest(req: Request): string[] {
  const userId = req.authSession?.user.id ?? '';
  const role = req.membership?.role ?? 'viewer';
  return aclTokensForPrincipal(userId, role, req.membership?.groupIds ?? []);
}

function safeSummaryForRole<T extends { acl: string[] }>(summary: T, req: Request): T {
  return req.membership?.role === 'admin' ? summary : { ...summary, acl: [] };
}
