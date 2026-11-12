import { randomUUID } from 'node:crypto';
import type { Document } from 'mongodb';
import {
  AuditLogFilterSchema,
  AuditLogRecordSchema,
  type AuditLogOutcome,
  type AuditLogRecord,
} from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

type AuditLogRow = AuditLogRecord & Document;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collection() {
  return getDatabase().collection<AuditLogRow>('auditLogs');
}

export const auditLogsRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      collection().createIndex(
        { organizationId: 1, createdAt: -1 },
        { name: 'audit_logs_workspace_recent' },
      ),
      collection().createIndex(
        { organizationId: 1, actorUserId: 1, createdAt: -1 },
        { name: 'audit_logs_workspace_actor_recent' },
      ),
    ]);
  },

  async record(input: {
    organizationId: string;
    actorUserId: string;
    actorName: string;
    actorEmail: string;
    outcome: AuditLogOutcome;
    question: string;
    lowConfidence?: boolean;
    documentIds?: string[];
    documentNames?: string[];
  }): Promise<void> {
    const now = new Date();
    const record = AuditLogRecordSchema.parse({
      _id: randomUUID(),
      ...input,
      action: 'chat',
      documentIds: [...new Set(input.documentIds ?? [])].slice(0, 100),
      documentNames: [...new Set(input.documentNames ?? [])].slice(0, 100),
      createdAt: now,
    }) as AuditLogRow;
    await collection().insertOne(record);
  },

  async list(
    organizationId: string,
    rawFilter: unknown,
  ): Promise<{ logs: AuditLogRecord[]; hasMore: boolean }> {
    const filter = AuditLogFilterSchema.parse(rawFilter);
    const query: Document = { organizationId };
    if (filter.outcome) query.outcome = filter.outcome;
    if (filter.from || filter.to) {
      const createdAt: Document = {};
      if (filter.from) createdAt.$gte = new Date(filter.from);
      if (filter.to) createdAt.$lte = new Date(filter.to);
      query.createdAt = createdAt;
    }
    if (filter.q) {
      const expression = new RegExp(escapeRegex(filter.q), 'i');
      query.$or = [
        { actorName: expression },
        { actorEmail: expression },
        { question: expression },
        { documentNames: expression },
      ];
    }
    const rows = await collection()
      .find(query)
      .sort({ createdAt: -1 })
      .limit(filter.limit + 1)
      .toArray();
    const hasMore = rows.length > filter.limit;
    return {
      logs: rows.slice(0, filter.limit).map((row) => AuditLogRecordSchema.parse(row)),
      hasMore,
    };
  },
};
