import type { Document } from 'mongodb';
import { getDatabase } from '../../lib/connections.js';

type AggregateTotal = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  retrieval: number;
  embedding: number;
  search: number;
  rerank: number;
  generation: number;
  total: number;
};

function numeric(field: string) {
  return { $ifNull: [`$observability.${field}`, 0] };
}

export const usageRepository = {
  async summarize(
    organizationId: string,
    since: Date,
  ): Promise<{
    totals: AggregateTotal;
    daily: Array<{
      date: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }>;
  }> {
    const collection = getDatabase().collection<Document>('messages');
    const match = {
      organizationId,
      role: 'assistant',
      createdAt: { $gte: since },
      observability: { $exists: true },
    };
    const [totalsRows, dailyRows] = await Promise.all([
      collection
        .aggregate<AggregateTotal>([
          { $match: match },
          {
            $group: {
              _id: null,
              requests: { $sum: 1 },
              inputTokens: { $sum: numeric('inputTokens') },
              outputTokens: { $sum: numeric('outputTokens') },
              totalTokens: { $sum: numeric('totalTokens') },
              estimatedCostUsd: { $sum: numeric('estimatedCostUsd') },
              retrieval: { $avg: numeric('latencyMs.retrieval') },
              embedding: { $avg: numeric('latencyMs.embedding') },
              search: { $avg: numeric('latencyMs.search') },
              rerank: { $avg: numeric('latencyMs.rerank') },
              generation: { $avg: numeric('latencyMs.generation') },
              total: { $avg: numeric('latencyMs.total') },
            },
          },
          { $project: { _id: 0 } },
        ])
        .toArray(),
      collection
        .aggregate<{
          date: string;
          requests: number;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
        }>([
          { $match: match },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
              requests: { $sum: 1 },
              inputTokens: { $sum: numeric('inputTokens') },
              outputTokens: { $sum: numeric('outputTokens') },
              estimatedCostUsd: { $sum: numeric('estimatedCostUsd') },
            },
          },
          {
            $project: {
              _id: 0,
              date: '$_id',
              requests: 1,
              inputTokens: 1,
              outputTokens: 1,
              estimatedCostUsd: 1,
            },
          },
          { $sort: { date: 1 } },
        ])
        .toArray(),
    ]);
    const totals = totalsRows[0] ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      retrieval: 0,
      embedding: 0,
      search: 0,
      rerank: 0,
      generation: 0,
      total: 0,
    };
    return { totals, daily: dailyRows };
  },
};
