import { Router } from 'express';
import { requireOrganizationRole, requireAuth } from '../../auth/auth.middleware.js';
import {
  createTeamGroupController,
  deleteTeamGroupController,
  createWorkspaceInvitationController,
  listWorkspaceInvitationsController,
  addOrganizationMemberController,
  listMembersController,
  removeOrganizationMemberController,
  updateOrganizationMemberRoleController,
  revokeWorkspaceInvitationController,
  listTeamGroupsController,
  updateMemberGroupsController,
  updateTeamGroupController,
} from './organizations.controller.js';
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
  updateCollectionAccessController,
  updateDocumentAccessController,
  getCollectionAccessController,
} from '../documents/documents.controller.js';
import {
  getRetrievalSettingsController,
  updateRetrievalSettingsController,
} from './retrieval-settings.controller.js';
import { listEvalRunsController } from '../evals/eval-runs.controller.js';

export const organizationsRouter = Router();

organizationsRouter.get(
  '/:organizationId/members',
  requireAuth,
  requireOrganizationRole(['admin']),
  listMembersController,
);
organizationsRouter.post(
  '/:organizationId/members',
  requireAuth,
  requireOrganizationRole(['admin']),
  addOrganizationMemberController,
);
organizationsRouter.delete(
  '/:organizationId/members/:userId',
  requireAuth,
  requireOrganizationRole(['admin']),
  removeOrganizationMemberController,
);
organizationsRouter.patch(
  '/:organizationId/members/:userId/role',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateOrganizationMemberRoleController,
);
organizationsRouter.get(
  '/:organizationId/groups',
  requireAuth,
  requireOrganizationRole(['admin']),
  listTeamGroupsController,
);
organizationsRouter.post(
  '/:organizationId/groups',
  requireAuth,
  requireOrganizationRole(['admin']),
  createTeamGroupController,
);
organizationsRouter.patch(
  '/:organizationId/groups/:groupId',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateTeamGroupController,
);
organizationsRouter.delete(
  '/:organizationId/groups/:groupId',
  requireAuth,
  requireOrganizationRole(['admin']),
  deleteTeamGroupController,
);
organizationsRouter.patch(
  '/:organizationId/members/:userId/groups',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateMemberGroupsController,
);
organizationsRouter.get(
  '/:organizationId/invitations',
  requireAuth,
  requireOrganizationRole(['admin']),
  listWorkspaceInvitationsController,
);
organizationsRouter.post(
  '/:organizationId/invitations',
  requireAuth,
  requireOrganizationRole(['admin']),
  createWorkspaceInvitationController,
);
organizationsRouter.delete(
  '/:organizationId/invitations/:invitationId',
  requireAuth,
  requireOrganizationRole(['admin']),
  revokeWorkspaceInvitationController,
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
organizationsRouter.patch(
  '/:organizationId/collections/:collectionId/access',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateCollectionAccessController,
);
organizationsRouter.get(
  '/:organizationId/collections/:collectionId/access',
  requireAuth,
  requireOrganizationRole(['admin']),
  getCollectionAccessController,
);
organizationsRouter.patch(
  '/:organizationId/documents/:documentId/access',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateDocumentAccessController,
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
organizationsRouter.get(
  '/:organizationId/evals',
  requireAuth,
  requireOrganizationRole(['admin']),
  listEvalRunsController,
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
