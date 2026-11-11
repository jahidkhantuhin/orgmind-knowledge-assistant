import type { RequestHandler } from 'express';
import { AuditLogFilterSchema, AuditLogResponseSchema } from '@orgmind/shared';
import { auditLogsRepository } from './audit-logs.repository.js';

export const listAuditLogsController: RequestHandler = async (req, res) => {
  const value = req.params.organizationId;
  const organizationId = Array.isArray(value) ? value[0] : value;
  const filter = AuditLogFilterSchema.safeParse(req.query);
  if (!organizationId || !filter.success) {
    res.status(400).json({
      error: { code: 'INVALID_AUDIT_FILTER', message: 'Choose valid audit filters.' },
    });
    return;
  }
  if (
    filter.data.from &&
    filter.data.to &&
    new Date(filter.data.from).getTime() > new Date(filter.data.to).getTime()
  ) {
    res.status(400).json({
      error: {
        code: 'INVALID_AUDIT_FILTER',
        message: 'The start date must be before the end date.',
      },
    });
    return;
  }
  const result = await auditLogsRepository.list(organizationId, filter.data);
  res.json(
    AuditLogResponseSchema.parse({
      logs: result.logs.map((record) => ({
        ...record,
        id: record._id,
        createdAt: record.createdAt.toISOString(),
      })),
      hasMore: result.hasMore,
    }),
  );
};
