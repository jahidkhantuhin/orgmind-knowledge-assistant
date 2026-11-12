import type { RequestHandler } from 'express';
import {
  CreateGoogleDriveAuthorizationSchema,
  GoogleDriveIntegrationsResponseSchema,
  UpdateGoogleDriveIntegrationAccessSchema,
} from '@orgmind/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { googleDriveService } from './google-drive.service.js';

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function finishOAuth(res: Parameters<RequestHandler>[1], status: 'connected' | 'error') {
  const destination = new URL('/settings/integrations', env.WEB_ORIGIN);
  destination.searchParams.set('googleDrive', status);
  res.redirect(302, destination.toString());
}

export const listGoogleDriveIntegrationsController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  if (!organizationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Workspace is required.' } });
    return;
  }
  res.json(
    GoogleDriveIntegrationsResponseSchema.parse({
      integrations: await googleDriveService.list(organizationId),
    }),
  );
};

export const authorizeGoogleDriveController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const ownerUserId = req.authSession?.user.id;
  const input = CreateGoogleDriveAuthorizationSchema.safeParse(req.body);
  if (!organizationId || !ownerUserId || !input.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_GOOGLE_DRIVE_SOURCE',
        message: 'Enter a valid Google Drive file URL or ID.',
      },
    });
    return;
  }
  try {
    const authorizationUrl = await googleDriveService.startAuthorization(
      organizationId,
      ownerUserId,
      input.data.fileUrl,
      input.data.accessRoles,
    );
    res.json({ authorizationUrl });
  } catch (error) {
    res.status(503).json({
      error: {
        code: 'GOOGLE_DRIVE_NOT_CONFIGURED',
        message: error instanceof Error ? error.message : 'Google Drive is not configured.',
      },
    });
  }
};

export const googleDriveOAuthCallbackController: RequestHandler = async (req, res) => {
  const query = res.locals.googleDriveOAuthQuery as Record<string, unknown> | undefined;
  if (!query) {
    finishOAuth(res, 'error');
    return;
  }
  const code = typeof query.code === 'string' ? query.code : '';
  const state = typeof query.state === 'string' ? query.state : '';
  if (!code || !state || query.error) {
    finishOAuth(res, 'error');
    return;
  }
  try {
    await googleDriveService.completeAuthorization(code, state);
    finishOAuth(res, 'connected');
  } catch (error) {
    logger.warn({ err: error }, 'Google Drive OAuth callback failed');
    finishOAuth(res, 'error');
  }
};

export const syncGoogleDriveIntegrationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const integrationId = routeParam(req.params.integrationId);
  if (!organizationId || !integrationId) {
    res.status(400).json({
      error: { code: 'INVALID_GOOGLE_DRIVE_SOURCE', message: 'Google Drive source is required.' },
    });
    return;
  }
  try {
    res.json(await googleDriveService.sync(organizationId, integrationId));
  } catch (error) {
    res
      .status(
        'statusCode' in (error as object)
          ? Number((error as { statusCode: number }).statusCode)
          : 502,
      )
      .json({
        error: {
          code: 'GOOGLE_DRIVE_SYNC_FAILED',
          message: error instanceof Error ? error.message : 'Could not sync Google Drive file.',
        },
      });
  }
};

export const updateGoogleDriveAccessController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const integrationId = routeParam(req.params.integrationId);
  const input = UpdateGoogleDriveIntegrationAccessSchema.safeParse(req.body);
  if (!organizationId || !integrationId || !input.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ACCESS', message: 'Choose valid workspace roles.' } });
    return;
  }
  try {
    res.json(
      await googleDriveService.updateAccess(organizationId, integrationId, input.data.accessRoles),
    );
  } catch {
    res.status(404).json({
      error: {
        code: 'GOOGLE_DRIVE_INTEGRATION_NOT_FOUND',
        message: 'Google Drive source not found.',
      },
    });
  }
};

export const deleteGoogleDriveIntegrationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const integrationId = routeParam(req.params.integrationId);
  if (!organizationId || !integrationId) {
    res.status(400).json({
      error: { code: 'INVALID_GOOGLE_DRIVE_SOURCE', message: 'Google Drive source is required.' },
    });
    return;
  }
  try {
    await googleDriveService.delete(organizationId, integrationId);
    res.status(204).end();
  } catch {
    res.status(404).json({
      error: {
        code: 'GOOGLE_DRIVE_INTEGRATION_NOT_FOUND',
        message: 'Google Drive source not found.',
      },
    });
  }
};
