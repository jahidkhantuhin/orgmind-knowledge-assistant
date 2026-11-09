import type { RequestHandler } from 'express';
import { EvalRunsResponseSchema } from '@orgmind/shared';
import { evalRunsRepository } from './eval-runs.repository.js';

export const listEvalRunsController: RequestHandler = async (req, res) => {
  const organizationId = req.params.organizationId;
  const id = Array.isArray(organizationId) ? organizationId[0] : organizationId;
  if (!id) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Workspace is required.' } });
    return;
  }
  const runs = await evalRunsRepository.listByOrganization(id);
  res.json(
    EvalRunsResponseSchema.parse({
      runs: runs.map((run) => ({
        ...run,
        id: run._id,
        createdAt: run.createdAt.toISOString(),
      })),
    }),
  );
};
