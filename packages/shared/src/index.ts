import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  services: z.object({
    api: z.literal('ok'),
    mongodb: z.enum(['connected', 'disconnected']),
    redis: z.enum(['connected', 'disconnected']),
  }),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const MembershipRoleSchema = z.enum(['admin', 'member', 'viewer']);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const GitHubIntegrationStatusSchema = z.enum(['connected', 'syncing', 'ready', 'error']);
export const GitHubIntegrationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  provider: z.literal('github'),
  owner: z.string().min(1),
  repository: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
  accessRoles: z.array(z.enum(['member', 'viewer'])),
  status: GitHubIntegrationStatusSchema,
  documentId: z.string().min(1).optional(),
  lastSyncedAt: z.string().datetime().optional(),
  errorMessage: z.string().max(500).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GitHubIntegration = z.infer<typeof GitHubIntegrationSchema>;

export const CreateGitHubIntegrationSchema = z.object({
  owner: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,100}$/),
  repository: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]{1,100}$/),
  branch: z.string().trim().min(1).max(255).default('main'),
  path: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !value.split('/').includes('..'), 'Path traversal is not allowed.')
    .refine((value) => /\.(md|markdown|txt)$/i.test(value), 'Use a Markdown or TXT file path.'),
  accessRoles: z
    .array(z.enum(['member', 'viewer']))
    .max(2)
    .default([]),
  accessToken: z.string().trim().min(1).max(500),
});
export type CreateGitHubIntegration = z.infer<typeof CreateGitHubIntegrationSchema>;

export const UpdateGitHubIntegrationAccessSchema = z.object({
  accessRoles: z.array(z.enum(['member', 'viewer'])).max(2),
});

export const GitHubIntegrationsResponseSchema = z.object({
  integrations: z.array(GitHubIntegrationSchema),
});

export const OrganizationDocumentSchema = z.object({
  _id: z.string().min(1),
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(120),
  workspaceNameKey: z.string().min(1).optional(),
  ownerId: z.string().min(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OrganizationDocument = z.infer<typeof OrganizationDocumentSchema>;

export const MembershipDocumentSchema = z.object({
  _id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  role: MembershipRoleSchema,
  groupIds: z.array(z.string().min(1)).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MembershipDocument = z.infer<typeof MembershipDocumentSchema>;

const RegisterFieldsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(12).max(128),
});

export const RegisterSchema = z.discriminatedUnion('workspaceMode', [
  RegisterFieldsSchema.extend({
    workspaceMode: z.literal('create'),
    organizationName: z.string().trim().min(2).max(100),
  }),
  RegisterFieldsSchema.extend({
    workspaceMode: z.literal('join'),
    inviteCode: z.string().trim().min(20).max(200),
  }),
]);
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const CreateWorkspaceInvitationSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: MembershipRoleSchema,
});

export const WorkspaceInvitationSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.email(),
  role: MembershipRoleSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type WorkspaceInvitationSummary = z.infer<typeof WorkspaceInvitationSummarySchema>;

export const WorkspaceInvitationsResponseSchema = z.object({
  invitations: z.array(WorkspaceInvitationSummarySchema),
});

export const CreateWorkspaceInvitationResponseSchema = z.object({
  invitation: WorkspaceInvitationSummarySchema,
  code: z.string().min(20),
});

export const WorkspaceInvitationPreviewSchema = z.object({
  email: z.email(),
  organizationName: z.string(),
  role: MembershipRoleSchema,
  expiresAt: z.string().datetime(),
});
export type WorkspaceInvitationPreview = z.infer<typeof WorkspaceInvitationPreviewSchema>;

export const WorkspaceInvitationDocumentSchema = z.object({
  _id: z.string().uuid(),
  organizationId: z.string().min(1),
  email: z.email(),
  role: MembershipRoleSchema,
  tokenHash: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.date(),
  expiresAt: z.date(),
  status: z.enum(['pending', 'accepted', 'revoked']),
  acceptedBy: z.string().optional(),
  acceptedAt: z.date().optional(),
});
export type WorkspaceInvitationDocument = z.infer<typeof WorkspaceInvitationDocumentSchema>;

export const LoginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const UserSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export const OrganizationMembershipSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  role: MembershipRoleSchema,
});
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>;

export const AuthMeResponseSchema = z.object({
  user: UserSummarySchema,
  organizations: z.array(OrganizationMembershipSchema),
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const OrganizationMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  role: MembershipRoleSchema,
  groupIds: z.array(z.string().min(1)).default([]),
  joinedAt: z.string().datetime(),
});
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;

export const OrganizationMembersResponseSchema = z.object({
  members: z.array(OrganizationMemberSchema),
  invitations: z.array(WorkspaceInvitationSummarySchema),
});
export type OrganizationMembersResponse = z.infer<typeof OrganizationMembersResponseSchema>;

export const AddOrganizationMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: MembershipRoleSchema,
});

export const UpdateOrganizationMemberRoleSchema = z.object({
  role: MembershipRoleSchema,
});

export const UserDocumentSchema = z.object({
  id: z.string().optional(),
  _id: z.unknown().optional(),
  name: z.string(),
  email: z.email(),
});
export type UserDocument = z.infer<typeof UserDocumentSchema>;

export const MigrationDocumentSchema = z.object({
  _id: z.string(),
  appliedAt: z.date(),
});
export type MigrationDocument = z.infer<typeof MigrationDocumentSchema>;

export const SecurityNoticeSchema = z.object({
  kind: z.enum(['redacted', 'blocked']),
  message: z.string().min(1).max(240),
});
export type SecurityNotice = z.infer<typeof SecurityNoticeSchema>;

export const AuditLogOutcomeSchema = z.enum(['answered', 'redacted', 'blocked', 'failed']);
export type AuditLogOutcome = z.infer<typeof AuditLogOutcomeSchema>;

export const AuditLogRecordSchema = z.object({
  _id: z.string().uuid(),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  actorName: z.string().min(1).max(120),
  actorEmail: z.email(),
  action: z.literal('chat'),
  outcome: AuditLogOutcomeSchema,
  question: z.string().min(1).max(2_000),
  documentIds: z.array(z.string().min(1)).max(100),
  documentNames: z.array(z.string().min(1).max(255)).max(100),
  createdAt: z.date(),
});
export type AuditLogRecord = z.infer<typeof AuditLogRecordSchema>;

export const AuditLogEntrySchema = AuditLogRecordSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
}).omit({ _id: true });
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogFilterSchema = z.object({
  q: z.string().trim().max(120).default(''),
  outcome: AuditLogOutcomeSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const AuditLogResponseSchema = z.object({
  logs: z.array(AuditLogEntrySchema),
  hasMore: z.boolean(),
});

export const DocumentExtensionSchema = z.enum(['pdf', 'docx', 'md', 'txt']);
export type DocumentExtension = z.infer<typeof DocumentExtensionSchema>;

export const DocumentStatusSchema = z.enum([
  'uploaded',
  'parsing',
  'chunking',
  'embedding',
  'parsed',
  'failed',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentRecordSchema = z.object({
  _id: z.string().uuid(),
  organizationId: z.string().min(1),
  ownerId: z.string().min(1),
  collectionId: z.string().min(1).default('default'),
  acl: z.array(z.string().min(1)).default([]),
  originalName: z.string().min(1).max(255),
  extension: DocumentExtensionSchema,
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  storageKey: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|docx|md|txt)$/i,
    ),
  status: DocumentStatusSchema,
  progress: z.number().int().min(0).max(100).optional(),
  extractedText: z.string().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  failureReason: z.string().max(500).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  parsedAt: z.date().optional(),
  chunkedAt: z.date().optional(),
  embeddedAt: z.date().optional(),
});
export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;

export const DocumentSummarySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  ownerId: z.string(),
  collectionId: z.string().min(1).default('default'),
  acl: z.array(z.string().min(1)).default([]),
  originalName: z.string(),
  extension: DocumentExtensionSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  status: DocumentStatusSchema,
  progress: z.number().int().min(0).max(100).optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  failureReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  parsedAt: z.string().datetime().optional(),
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const OrganizationDocumentsResponseSchema = z.object({
  documents: z.array(DocumentSummarySchema),
});
export type OrganizationDocumentsResponse = z.infer<typeof OrganizationDocumentsResponseSchema>;

export const ConversationRecordSchema = z.object({
  _id: z.string().uuid(),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationListResponseSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
});
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export const RetrievalDebugSchema = z.object({
  fusedRank: z.number().int().positive().nullable().optional(),
  vectorRank: z.number().int().positive().nullable(),
  vectorScore: z.number().nullable(),
  keywordRank: z.number().int().positive().nullable(),
  keywordScore: z.number().nullable(),
  fusedScore: z.number().min(0),
  rerankRank: z.number().int().positive().nullable().optional(),
  rerankScore: z.number().nullable().optional(),
});
export type RetrievalDebug = z.infer<typeof RetrievalDebugSchema>;

export const RetrievalDebugChunkSchema = RetrievalDebugSchema.extend({
  chunkId: z.string(),
  documentId: z.string().uuid().optional(),
  documentName: z.string(),
  chunkIndex: z.number().int().nonnegative(),
});
export type RetrievalDebugChunk = z.infer<typeof RetrievalDebugChunkSchema>;

export const RetrievalSettingsRecordSchema = z.object({
  _id: z.string().min(1),
  rerankingEnabled: z.boolean(),
  queryRewriteEnabled: z.boolean(),
  updatedAt: z.date(),
});
export type RetrievalSettingsRecord = z.infer<typeof RetrievalSettingsRecordSchema>;

export const RetrievalSettingsResponseSchema = z.object({
  rerankingEnabled: z.boolean(),
  queryRewriteEnabled: z.boolean(),
  rerankerAvailable: z.boolean(),
});
export type RetrievalSettingsResponse = z.infer<typeof RetrievalSettingsResponseSchema>;

export const UpdateRetrievalSettingsSchema = z.object({
  rerankingEnabled: z.boolean(),
  queryRewriteEnabled: z.boolean(),
});

export const ContextualEnrichmentCacheSchema = z.object({
  _id: z.string().min(1),
  organizationId: z.string().min(1),
  documentId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  context: z.string().min(1).max(500),
  createdAt: z.date(),
  expiresAt: z.date(),
});
export type ContextualEnrichmentCache = z.infer<typeof ContextualEnrichmentCacheSchema>;

export const ChatCitationSchema = z.object({
  chunkId: z.string(),
  documentId: z.string().uuid(),
  documentName: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  headingPath: z.array(z.string()),
  passage: z.string().min(1),
  score: z.number().min(0).max(1),
  retrievalDebug: RetrievalDebugSchema.optional(),
});
export type ChatCitation = z.infer<typeof ChatCitationSchema>;

export function citationsReferencedInAnswer(
  answer: string,
  citations: ChatCitation[],
): ChatCitation[] {
  const normalizedAnswer = answer.trim().replace(/^[\s>*#]+/, '');
  if (
    /^(?:i (?:do not|don't) know|i (?:cannot|can't) determine|there is not enough information|the (?:available )?documents? (?:do not|don't|does not|doesn't) (?:say|specify|contain))/i.test(
      normalizedAnswer,
    )
  ) {
    return [];
  }
  const referencedIndexes = new Set(
    [...answer.matchAll(/\[S(\d+)\]/gi)]
      .map((match) => Number(match[1]) - 1)
      .filter((index) => index >= 0),
  );
  return citations.filter((_citation, index) => referencedIndexes.has(index));
}

export const ChatObservabilitySchema = z.object({
  traceId: z
    .string()
    .nullable()
    .transform((traceId) => traceId ?? undefined)
    .optional(),
  modelId: z.string().optional(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
  cacheHit: z.boolean().optional(),
  cacheSimilarity: z.number().min(0).max(1).optional(),
  latencyMs: z.object({
    retrieval: z.number().nonnegative().default(0),
    embedding: z.number().nonnegative().default(0),
    search: z.number().nonnegative().default(0),
    rerank: z.number().nonnegative().default(0),
    generation: z.number().nonnegative().default(0),
    total: z.number().nonnegative().default(0),
  }),
});
export type ChatObservability = z.infer<typeof ChatObservabilitySchema>;

export const ChatMessageRecordSchema = z.object({
  _id: z.string().uuid(),
  organizationId: z.string().min(1),
  conversationId: z.string().uuid(),
  userId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(ChatCitationSchema).default([]),
  retrievalDebug: z.array(RetrievalDebugChunkSchema).default([]),
  observability: ChatObservabilitySchema.optional(),
  securityNotice: SecurityNoticeSchema.optional(),
  createdAt: z.date(),
});
export type ChatMessageRecord = z.infer<typeof ChatMessageRecordSchema>;

export const ChatMessageResponseSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(ChatCitationSchema),
  retrievalDebug: z.array(RetrievalDebugChunkSchema).default([]),
  observability: ChatObservabilitySchema.optional(),
  securityNotice: SecurityNoticeSchema.optional(),
  createdAt: z.string().datetime(),
});
export type ChatMessageResponse = z.infer<typeof ChatMessageResponseSchema>;

export const ConversationMessagesResponseSchema = z.object({
  conversation: ConversationSummarySchema,
  messages: z.array(ChatMessageResponseSchema),
});
export type ConversationMessagesResponse = z.infer<typeof ConversationMessagesResponseSchema>;

export const CreateConversationSchema = z.object({
  organizationId: z.string().min(1),
});
export const RenameConversationSchema = z.object({
  title: z.string().trim().min(1).max(120),
});
export const ChatRequestSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().uuid(),
  mode: z.enum(['simple', 'agentic']).default('simple'),
  modelPreference: z.enum(['auto', 'fast', 'strong']).default('auto'),
  messages: z.array(z.unknown()).min(1).max(40),
});

export const DocumentChunkSchema = z.object({
  _id: z.string().min(1),
  documentId: z.string().uuid(),
  orgId: z.string().min(1),
  collectionId: z.string().min(1),
  acl: z.array(z.string()),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
  headingPath: z.array(z.string()),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  embedding: z.array(z.number().finite()).min(1),
  embeddingProfile: z.string().min(1).optional(),
  createdAt: z.date(),
});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

export const DocumentChunkPreviewSchema = DocumentChunkSchema.omit({
  orgId: true,
  collectionId: true,
  acl: true,
  embedding: true,
  embeddingProfile: true,
  createdAt: true,
});
export type DocumentChunkPreview = z.infer<typeof DocumentChunkPreviewSchema>;

export const EvalStrategySchema = z.enum(['vector', 'hybrid', 'hybrid-rerank', 'agentic']);
export type EvalStrategy = z.infer<typeof EvalStrategySchema>;

export const EvalMetricsSchema = z.object({
  recallAtK: z.number().min(0).max(1),
  mrr: z.number().min(0).max(1),
  groundedness: z.number().min(0).max(1),
  answerRelevance: z.number().min(0).max(1),
});
export type EvalMetrics = z.infer<typeof EvalMetricsSchema>;

export const EvalCaseResultSchema = z.object({
  caseId: z.string().min(1),
  question: z.string().min(1),
  expectedAnswer: z.string().min(1),
  answer: z.string(),
  expectedSourceIds: z.array(z.string()),
  retrievedSourceIds: z.array(z.string()),
  metrics: EvalMetricsSchema,
});
export type EvalCaseResult = z.infer<typeof EvalCaseResultSchema>;

export const EvalVariantResultSchema = z.object({
  strategy: EvalStrategySchema,
  metrics: EvalMetricsSchema,
  cases: z.array(EvalCaseResultSchema),
});
export type EvalVariantResult = z.infer<typeof EvalVariantResultSchema>;

export const EvalRunDocumentSchema = z.object({
  _id: z.string().uuid(),
  organizationId: z.string().min(1),
  createdAt: z.date(),
  modelId: z.string().min(1),
  topK: z.number().int().positive(),
  minimumRecallAtK: z.number().min(0).max(1),
  maximumRerankRecallDrop: z.number().min(0).max(1),
  passed: z.boolean(),
  variants: z.array(EvalVariantResultSchema).min(3).max(4),
});
export type EvalRunDocument = z.infer<typeof EvalRunDocumentSchema>;

export const EvalRunSummarySchema = EvalRunDocumentSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
}).omit({ _id: true });
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

export const EvalRunsResponseSchema = z.object({ runs: z.array(EvalRunSummarySchema) });
export type EvalRunsResponse = z.infer<typeof EvalRunsResponseSchema>;

export const UsageDaySchema = z.object({
  date: z.string(),
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export const UsageSummarySchema = z.object({
  since: z.string().datetime(),
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  averageLatencyMs: z.object({
    retrieval: z.number().nonnegative(),
    embedding: z.number().nonnegative(),
    search: z.number().nonnegative(),
    rerank: z.number().nonnegative(),
    generation: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }),
  daily: z.array(UsageDaySchema),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
export const UsageSummaryResponseSchema = z.object({ usage: UsageSummarySchema });

export const DocumentChunksPageResponseSchema = z.object({
  chunks: z.array(DocumentChunkPreviewSchema),
  nextCursor: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
});
export type DocumentChunksPageResponse = z.infer<typeof DocumentChunksPageResponseSchema>;

export const DocumentDetailResponseSchema = z.object({
  document: DocumentSummarySchema,
  chunks: z.array(DocumentChunkPreviewSchema),
});
export type DocumentDetailResponse = z.infer<typeof DocumentDetailResponseSchema>;

export const TeamGroupSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  createdAt: z.string().datetime(),
});
export type TeamGroup = z.infer<typeof TeamGroupSchema>;

export const TeamGroupsResponseSchema = z.object({ groups: z.array(TeamGroupSchema) });
export const CreateTeamGroupSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const UpdateTeamGroupSchema = CreateTeamGroupSchema;
export const UpdateMemberGroupsSchema = z.object({ groupIds: z.array(z.string().uuid()).max(50) });
export const UpdateAccessGrantsSchema = z.object({
  roles: z.array(MembershipRoleSchema).max(3),
  userIds: z.array(z.string().min(1)).max(100),
  groupIds: z.array(z.string().uuid()).max(50),
});
export const UpdateDocumentAccessSchema = UpdateAccessGrantsSchema.extend({
  collectionId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9 _-]+$/),
});
export const DocumentCollectionAccessResponseSchema = z.object({ acl: z.array(z.string()) });
