import { MigrationDocumentSchema, type MigrationDocument } from '@orgmind/shared';
import type { Collection, Document } from 'mongodb';
import { getDatabase } from '../../lib/connections.js';
import { membershipsRepository } from '../../modules/organizations/memberships.repository.js';
import { usersRepository } from '../../modules/users/users.repository.js';
import { documentsRepository } from '../../modules/documents/documents.repository.js';
import { chunksRepository } from '../../modules/documents/chunks.repository.js';
import { chatRepository } from '../../modules/chat/chat.repository.js';
import { contextualEnrichmentRepository } from '../../modules/documents/contextual-enrichment.repository.js';
import { retrievalSettingsRepository } from '../../modules/organizations/retrieval-settings.repository.js';
import { groupsRepository } from '../../modules/organizations/groups.repository.js';
import { documentCollectionsRepository } from '../../modules/documents/document-collections.repository.js';
import {
  normalizeWorkspaceName,
  organizationsRepository,
} from '../../modules/organizations/organizations.repository.js';
import { workspaceInvitationsRepository } from '../../modules/organizations/workspace-invitations.repository.js';
import { evalRunsRepository } from '../../modules/evals/eval-runs.repository.js';

export async function runMigrations(): Promise<void> {
  const database = getDatabase();
  const migrations = database.collection<MigrationDocument & Document>('schema_migrations');

  await applyMigration(migrations, '001-auth-organizations-indexes', async () => {
    await Promise.all([
      organizationsRepository.ensureIndexes(),
      membershipsRepository.ensureIndexes(),
      usersRepository.ensureIndexes(),
      database
        .collection('sessions')
        .createIndex({ token: 1 }, { unique: true, name: 'sessions_token_unique' }),
      database.collection('sessions').createIndex({ userId: 1 }, { name: 'sessions_user' }),
      database
        .collection('sessions')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_expiry' }),
      database.collection('accounts').createIndex({ userId: 1 }, { name: 'accounts_user' }),
      database
        .collection('accounts')
        .createIndex(
          { providerId: 1, accountId: 1 },
          { unique: true, name: 'accounts_provider_account_unique' },
        ),
      database
        .collection('verifications')
        .createIndex({ identifier: 1 }, { name: 'verifications_identifier' }),
    ]);
  });

  await applyMigration(migrations, '002-document-indexes', () =>
    documentsRepository.ensureIndexes(),
  );
  await applyMigration(migrations, '003-chunk-indexes', () => chunksRepository.ensureIndexes());
  await applyMigration(migrations, '004-chat-indexes', () => chatRepository.ensureIndexes());
  await applyMigration(migrations, '005-retrieval-settings-context-cache-indexes', async () => {
    await Promise.all([
      contextualEnrichmentRepository.ensureIndexes(),
      retrievalSettingsRepository.ensureIndexes(),
    ]);
  });
  await applyMigration(migrations, '006-acl-backfill', async () => {
    const workspaceAcl = ['role:admin', 'role:member', 'role:viewer'];
    await Promise.all([
      database
        .collection('documents')
        .updateMany(
          { $or: [{ acl: { $exists: false } }, { acl: { $size: 0 } }] },
          { $set: { acl: workspaceAcl, collectionId: 'default' } },
        ),
      database
        .collection('chunks')
        .updateMany(
          { $or: [{ acl: { $exists: false } }, { acl: { $size: 0 } }] },
          { $set: { acl: workspaceAcl, collectionId: 'default' } },
        ),
    ]);
  });
  await applyMigration(migrations, '007-team-group-indexes', () =>
    groupsRepository.ensureIndexes(),
  );
  await applyMigration(migrations, '008-document-collection-access', async () => {
    await documentCollectionsRepository.ensureIndexes();
    await documentCollectionsRepository.backfillFromDocuments();
  });
  await applyMigration(migrations, '009-unique-workspace-names', async () => {
    const organizations = database.collection<{ _id: string; name: string; createdAt?: Date }>(
      'organizations',
    );
    const rows = await organizations
      .find({}, { projection: { _id: 1, name: 1, createdAt: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const seen = new Set<string>();
    for (const row of rows) {
      const normalizedName = normalizeWorkspaceName(row.name);
      const uniqueKey = seen.has(normalizedName)
        ? `${normalizedName}::legacy:${row._id}`
        : normalizedName;
      seen.add(normalizedName);
      await organizations.updateOne({ _id: row._id }, { $set: { workspaceNameKey: uniqueKey } });
    }
    await organizationsRepository.ensureWorkspaceNameIndex();
  });
  await applyMigration(migrations, '010-workspace-invitations', () =>
    workspaceInvitationsRepository.ensureIndexes(),
  );
  await applyMigration(migrations, '011-evaluation-runs', () => evalRunsRepository.ensureIndexes());
  await applyMigration(migrations, '012-message-observability', () =>
    chatRepository.ensureUsageIndex(),
  );
}

async function applyMigration(
  migrations: Collection<MigrationDocument & Document>,
  migrationId: string,
  apply: () => Promise<void>,
): Promise<void> {
  const existing = await migrations.findOne({ _id: migrationId });
  if (existing) {
    MigrationDocumentSchema.parse(existing);
    return;
  }
  await apply();
  const record = MigrationDocumentSchema.parse({
    _id: migrationId,
    appliedAt: new Date(),
  }) as MigrationDocument & Document;
  await migrations.updateOne({ _id: migrationId }, { $setOnInsert: record }, { upsert: true });
}
