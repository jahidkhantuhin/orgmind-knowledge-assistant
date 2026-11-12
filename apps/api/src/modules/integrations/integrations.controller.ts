import type { RequestHandler } from 'express';
import {
  CreateGitHubIntegrationSchema,
  GitHubIntegrationsResponseSchema,
  UpdateGitHubIntegrationAccessSchema,
} from '@orgmind/shared';
import { integrationsService } from './integrations.service.js';
import {
  GitHubConnectionError,
  IntegrationBusyError,
  IntegrationNotFoundError,
} from './integrations.service.js';

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const listIntegrationsController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  if (!organizationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ORGANIZATION', message: 'Workspace is required.' } });
    return;
  }
  res.json(
    GitHubIntegrationsResponseSchema.parse({
      integrations: await integrationsService.list(organizationId),
    }),
  );
};

export const createIntegrationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const ownerUserId = req.authSession?.user.id;
  const input = CreateGitHubIntegrationSchema.safeParse(req.body);
  if (!organizationId || !ownerUserId || !input.success) {
    res.status(400).json({
      error: {
        code: 'INVALID_INTEGRATION',
        message: 'Check the repository details and access token.',
      },
    });
    return;
  }
  try {
    const integration = await integrationsService.create(organizationId, ownerUserId, input.data);
    res.status(201).json(integration);
  } catch (error) {
    if (error instanceof GitHubConnectionError) {
      res.status(502).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      res.status(409).json({
        error: {
          code: 'INTEGRATION_EXISTS',
          message: 'This repository file is already connected.',
        },
      });
      return;
    }
    throw error;
  }
};

export const syncIntegrationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const integrationId = routeParam(req.params.integrationId);
  if (!organizationId || !integrationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_INTEGRATION', message: 'GitHub source is required.' } });
    return;
  }
  try {
    res.json(await integrationsService.sync(organizationId, integrationId));
  } catch (error) {
    if (error instanceof IntegrationBusyError || error instanceof IntegrationNotFoundError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }
    res.status(502).json({
      error: {
        code: 'INTEGRATION_SYNC_FAILED',
        message: 'GitHub file sync failed. Check the source status for details and try again.',
      },
    });
  }
};

export const updateIntegrationAccessController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const integrationId = routeParam(req.params.integrationId);
  const input = UpdateGitHubIntegrationAccessSchema.safeParse(req.body);
  if (!organizationId || !integrationId || !input.success) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_ACCESS', message: 'Choose valid workspace roles.' } });
    return;
  }
  try {
    res.json(
      await integrationsService.updateAccess(organizationId, integrationId, input.data.accessRoles),
    );
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }
    throw error;
  }
};

export const deleteIntegrationController: RequestHandler = async (req, res) => {
  const organizationId = routeParam(req.params.organizationId);
  const integrationId = routeParam(req.params.integrationId);
  if (!organizationId || !integrationId) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_INTEGRATION', message: 'GitHub source is required.' } });
    return;
  }
  try {
    await integrationsService.delete(organizationId, integrationId);
    res.status(204).end();
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }
    throw error;
  }
};
