import { EvalRunDocumentSchema, type EvalRunDocument } from '@orgmind/shared';
import type { Collection, Document } from 'mongodb';
import { getDatabase } from '../../lib/connections.js';

type EvalRunRow = EvalRunDocument & Document;

function evalRuns(): Collection<EvalRunRow> {
  return getDatabase().collection<EvalRunRow>('evalRuns');
}

function parseEvalRun(value: unknown): EvalRunDocument {
  return EvalRunDocumentSchema.parse(value);
}

export const evalRunsRepository = {
  async ensureIndexes(): Promise<void> {
    await evalRuns().createIndex(
      { organizationId: 1, createdAt: -1 },
      { name: 'eval_runs_organization_created' },
    );
  },

  async create(run: EvalRunDocument): Promise<void> {
    await evalRuns().insertOne(parseEvalRun(run));
  },

  async listByOrganization(organizationId: string, limit = 25): Promise<EvalRunDocument[]> {
    const records = await evalRuns()
      .find({ organizationId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return records.map(parseEvalRun);
  },
};
