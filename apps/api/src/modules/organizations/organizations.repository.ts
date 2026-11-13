import { randomUUID } from 'node:crypto';
import { type Collection, type Document } from 'mongodb';
import { OrganizationDocumentSchema, type OrganizationDocument } from '@orgmind/shared';
import { getDatabase } from '../../lib/connections.js';

type OrganizationRecord = OrganizationDocument & Document;

export class WorkspaceNameTakenError extends Error {
  constructor() {
    super(
      'A workspace with this company name already exists. Ask for an invitation or choose another name.',
    );
    this.name = 'WorkspaceNameTakenError';
  }
}

export function normalizeWorkspaceName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function organizations(): Collection<OrganizationRecord> {
  return getDatabase().collection<OrganizationRecord>('organizations');
}

function parseDocument(value: unknown): OrganizationDocument {
  return OrganizationDocumentSchema.parse(value);
}

function createSlug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${base || 'workspace'}-${randomUUID().slice(0, 8)}`;
}

export const organizationsRepository = {
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      organizations().createIndex({ slug: 1 }, { unique: true, name: 'organizations_slug_unique' }),
      organizations().createIndex(
        { ownerId: 1 },
        { unique: true, name: 'organizations_owner_unique' },
      ),
    ]);
  },

  async ensureWorkspaceNameIndex(): Promise<void> {
    await organizations().createIndex(
      { workspaceNameKey: 1 },
      { unique: true, name: 'organizations_workspace_name_unique' },
    );
  },

  async isWorkspaceNameTaken(name: string): Promise<boolean> {
    return Boolean(
      await organizations().findOne({ workspaceNameKey: normalizeWorkspaceName(name) }),
    );
  },

  async createForOwner(name: string, ownerId: string): Promise<OrganizationDocument> {
    const existing = await organizations().findOne({ ownerId });
    if (existing) return parseDocument(existing);

    const workspaceNameKey = normalizeWorkspaceName(name);
    if (await organizations().findOne({ workspaceNameKey })) throw new WorkspaceNameTakenError();

    const now = new Date();
    const document = parseDocument({
      _id: randomUUID(),
      name,
      slug: createSlug(name),
      workspaceNameKey,
      ownerId,
      createdAt: now,
      updatedAt: now,
    }) as OrganizationRecord;
    try {
      await organizations().insertOne(document);
      return document;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const createdByConcurrentRequest = await organizations().findOne({ ownerId });
        if (createdByConcurrentRequest) return parseDocument(createdByConcurrentRequest);
        if (await organizations().findOne({ workspaceNameKey }))
          throw new WorkspaceNameTakenError();
      }
      throw error;
    }
  },

  async findByIds(ids: string[]): Promise<OrganizationDocument[]> {
    if (ids.length === 0) return [];
    const rows = await organizations()
      .find({ _id: { $in: ids } })
      .toArray();
    return rows.map(parseDocument);
  },

  async findOwnedBy(ownerId: string): Promise<OrganizationDocument | null> {
    const row = await organizations().findOne({ ownerId });
    return row ? parseDocument(row) : null;
  },
};
