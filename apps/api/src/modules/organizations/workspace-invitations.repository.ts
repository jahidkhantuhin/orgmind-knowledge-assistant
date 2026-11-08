import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  WorkspaceInvitationDocumentSchema,
  type MembershipRole,
  type WorkspaceInvitationDocument,
} from '@orgmind/shared';
import type { Collection, Document } from 'mongodb';
import { getDatabase, mongoClient } from '../../lib/connections.js';
import { organizationsRepository } from './organizations.repository.js';
import { membershipsRepository } from './memberships.repository.js';

type InvitationRecord = WorkspaceInvitationDocument & Document;

function invitations(): Collection<InvitationRecord> {
  return getDatabase().collection<InvitationRecord>('workspace_invitations');
}

function parseInvitation(value: unknown): WorkspaceInvitationDocument {
  return WorkspaceInvitationDocumentSchema.parse(value);
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export class WorkspaceInvitationError extends Error {
  constructor(message = 'This invitation is invalid, expired, or already used.') {
    super(message);
    this.name = 'WorkspaceInvitationError';
  }
}

export const workspaceInvitationsRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      invitations().createIndex(
        { tokenHash: 1 },
        { unique: true, name: 'workspace_invitations_token_unique' },
      ),
      invitations().createIndex(
        { organizationId: 1, email: 1, status: 1 },
        { name: 'workspace_invitations_org_email_status' },
      ),
      invitations().createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'workspace_invitations_expiry' },
      ),
    ]);
  },

  async create(input: {
    organizationId: string;
    email: string;
    role: MembershipRole;
    createdBy: string;
  }): Promise<{ invitation: WorkspaceInvitationDocument; code: string }> {
    const session = mongoClient.startSession();
    const code = randomBytes(32).toString('base64url');
    const now = new Date();
    const invitation = parseInvitation({
      _id: randomUUID(),
      organizationId: input.organizationId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      tokenHash: hashCode(code),
      createdBy: input.createdBy,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      status: 'pending',
    });
    try {
      await session.withTransaction(async () => {
        await invitations().updateMany(
          { organizationId: input.organizationId, email: invitation.email, status: 'pending' },
          { $set: { status: 'revoked' } },
          { session },
        );
        await invitations().insertOne(invitation as InvitationRecord, { session });
      });
      return { invitation, code };
    } finally {
      await session.endSession();
    }
  },

  async listPending(organizationId: string): Promise<WorkspaceInvitationDocument[]> {
    const rows = await invitations()
      .find({ organizationId, status: 'pending', expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .toArray();
    return rows.map(parseInvitation);
  },

  async preview(
    code: string,
    email: string,
  ): Promise<{
    invitation: WorkspaceInvitationDocument;
    organizationName: string;
  } | null> {
    const invitation = await invitations().findOne({
      tokenHash: hashCode(code),
      email: email.trim().toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });
    if (!invitation) return null;
    const organization = (await organizationsRepository.findByIds([invitation.organizationId]))[0];
    return organization
      ? { invitation: parseInvitation(invitation), organizationName: organization.name }
      : null;
  },

  async accept(code: string, email: string, userId: string): Promise<WorkspaceInvitationDocument> {
    const session = mongoClient.startSession();
    let accepted: WorkspaceInvitationDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const row = await invitations().findOneAndUpdate(
          {
            tokenHash: hashCode(code),
            email: email.trim().toLowerCase(),
            status: 'pending',
            expiresAt: { $gt: new Date() },
          },
          { $set: { status: 'accepted', acceptedBy: userId, acceptedAt: new Date() } },
          { returnDocument: 'after', session },
        );
        if (!row) throw new WorkspaceInvitationError();
        const invitation = parseInvitation(row);
        await membershipsRepository.ensureMembership(
          invitation.organizationId,
          userId,
          invitation.role,
          session,
        );
        accepted = invitation;
      });
      if (!accepted) throw new WorkspaceInvitationError();
      return accepted;
    } finally {
      await session.endSession();
    }
  },

  async revoke(organizationId: string, invitationId: string): Promise<boolean> {
    const result = await invitations().updateOne(
      { _id: invitationId, organizationId, status: 'pending' },
      { $set: { status: 'revoked' } },
    );
    return result.modifiedCount === 1;
  },
};
