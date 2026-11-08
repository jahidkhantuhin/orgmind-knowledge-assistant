import { Router } from 'express';
import { requireOrganizationRole, requireAuth } from '../../auth/auth.middleware.js';
import { listMembersController } from './organizations.controller.js';
import {
  createConversationController,
  deleteConversationController,
  getConversationController,
  listConversationsController,
  renameConversationController,
  streamChatController,
} from '../chat/chat.controller.js';
import { uploadDocumentFile } from '../documents/document-storage.js';
import {
  deleteDocumentController,
  getDocumentDetailController,
  listDocumentChunksController,
  listDocumentsController,
  reingestDocumentController,
  uploadDocumentController,
} from '../documents/documents.controller.js';
import {
  getRetrievalSettingsController,
  updateRetrievalSettingsController,
} from './retrieval-settings.controller.js';

export const organizationsRouter = Router();

organizationsRouter.get(
  '/:organizationId/members',
  requireAuth,
  requireOrganizationRole(['admin']),
  listMembersController,
);
organizationsRouter.get(
  '/:organizationId/chat/conversations',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  listConversationsController,
);
organizationsRouter.post(
  '/:organizationId/chat/conversations',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  createConversationController,
);
organizationsRouter.get(
  '/:organizationId/chat/conversations/:conversationId',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  getConversationController,
);
organizationsRouter.patch(
  '/:organizationId/chat/conversations/:conversationId',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  renameConversationController,
);
organizationsRouter.delete(
  '/:organizationId/chat/conversations/:conversationId',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  deleteConversationController,
);
organizationsRouter.post(
  '/:organizationId/chat',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  streamChatController,
);
organizationsRouter.get(
  '/:organizationId/chat/retrieval-settings',
  requireAuth,
  requireOrganizationRole(['admin']),
  getRetrievalSettingsController,
);
organizationsRouter.patch(
  '/:organizationId/chat/retrieval-settings',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateRetrievalSettingsController,
);

organizationsRouter.get(
  '/:organizationId/documents',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  listDocumentsController,
);
organizationsRouter.post(
  '/:organizationId/documents',
  requireAuth,
  requireOrganizationRole(['admin', 'member']),
  uploadDocumentFile,
  uploadDocumentController,
);
organizationsRouter.get(
  '/:organizationId/documents/:documentId',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  getDocumentDetailController,
);
organizationsRouter.get(
  '/:organizationId/documents/:documentId/chunks',
  requireAuth,
  requireOrganizationRole(['admin', 'member', 'viewer']),
  listDocumentChunksController,
);
organizationsRouter.post(
  '/:organizationId/documents/:documentId/reingest',
  requireAuth,
  requireOrganizationRole(['admin', 'member']),
  reingestDocumentController,
);
organizationsRouter.delete(
  '/:organizationId/documents/:documentId',
  requireAuth,
  requireOrganizationRole(['admin', 'member']),
  deleteDocumentController,
);
