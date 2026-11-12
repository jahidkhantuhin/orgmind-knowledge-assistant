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
import { getOrganizationUsageController } from '../usage/usage.controller.js';
import { listAuditLogsController } from '../audit/audit-logs.controller.js';
import {
  createIntegrationController,
  deleteIntegrationController,
  listIntegrationsController,
  syncIntegrationController,
  updateIntegrationAccessController,
} from '../integrations/integrations.controller.js';
import {
  authorizeGoogleDriveController,
  deleteGoogleDriveIntegrationController,
  listGoogleDriveIntegrationsController,
  syncGoogleDriveIntegrationController,
  updateGoogleDriveAccessController,
} from '../integrations/google-drive.controller.js';
import { chatRateLimiter, ensureRateLimitStore } from '../../middleware/rate-limit.js';
import { rejectMongoOperatorKeys } from '../../middleware/reject-nosql-operators.js';

export const organizationsRouter = Router();

organizationsRouter.get(
  '/:organizationId/integrations/google-drive',
  requireAuth,
  requireOrganizationRole(['admin']),
  listGoogleDriveIntegrationsController,
);
organizationsRouter.post(
  '/:organizationId/integrations/google-drive/authorize',
  requireAuth,
  requireOrganizationRole(['admin']),
  authorizeGoogleDriveController,
);
organizationsRouter.post(
  '/:organizationId/integrations/google-drive/:integrationId/sync',
  requireAuth,
  requireOrganizationRole(['admin']),
  syncGoogleDriveIntegrationController,
);
organizationsRouter.patch(
  '/:organizationId/integrations/google-drive/:integrationId/access',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateGoogleDriveAccessController,
);
organizationsRouter.delete(
  '/:organizationId/integrations/google-drive/:integrationId',
  requireAuth,
  requireOrganizationRole(['admin']),
  deleteGoogleDriveIntegrationController,
);

organizationsRouter.get(
  '/:organizationId/integrations',
  requireAuth,
  requireOrganizationRole(['admin']),
  listIntegrationsController,
);
organizationsRouter.post(
  '/:organizationId/integrations',
  requireAuth,
  requireOrganizationRole(['admin']),
  createIntegrationController,
);
organizationsRouter.post(
  '/:organizationId/integrations/:integrationId/sync',
  requireAuth,
  requireOrganizationRole(['admin']),
  syncIntegrationController,
);
organizationsRouter.patch(
  '/:organizationId/integrations/:integrationId/access',
  requireAuth,
  requireOrganizationRole(['admin']),
  updateIntegrationAccessController,
);
organizationsRouter.delete(
  '/:organizationId/integrations/:integrationId',
  requireAuth,
  requireOrganizationRole(['admin']),
  deleteIntegrationController,
);

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
  ensureRateLimitStore,
  chatRateLimiter,
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
organizationsRouter.get(
  '/:organizationId/usage',
  requireAuth,
  requireOrganizationRole(['admin']),
  getOrganizationUsageController,
);
organizationsRouter.get(
  '/:organizationId/audit-logs',
  requireAuth,
  requireOrganizationRole(['admin']),
  listAuditLogsController,
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
  rejectMongoOperatorKeys,
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
