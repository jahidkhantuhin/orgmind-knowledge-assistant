import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { RequestHandler } from 'express';
import {
  AuthMeResponseSchema,
  type RegisterInput,
  UserSummarySchema,
  WorkspaceInvitationPreviewSchema,
} from '@orgmind/shared';
import { auth } from '../../auth/auth.js';
import { listMembershipsForUser } from '../organizations/organizations.service.js';
import {
  organizationsRepository,
  WorkspaceNameTakenError,
} from '../organizations/organizations.repository.js';
import {
  workspaceInvitationsRepository,
  WorkspaceInvitationError,
} from '../organizations/workspace-invitations.repository.js';

function forwardCookies(res: Parameters<RequestHandler>[1], headers: Headers): void {
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
}

function sendAuthError(error: unknown, res: Parameters<RequestHandler>[1]): boolean {
  if (!isAPIError(error)) return false;
  res.status(error.statusCode).json({ error: { code: 'AUTH_ERROR', message: error.message } });
  return true;
}

export const registerController: RequestHandler = async (req, res, next) => {
  try {
    const input = req.body as RegisterInput;
    if (input.workspaceMode === 'create') {
      if (await organizationsRepository.isWorkspaceNameTaken(input.organizationName)) {
        res.status(409).json({
          error: {
            code: 'WORKSPACE_NAME_TAKEN',
            message:
              'A workspace with this company name already exists. Ask for an invitation or choose another name.',
          },
        });
        return;
      }
    } else if (!(await workspaceInvitationsRepository.preview(input.inviteCode, input.email))) {
      res.status(400).json({
        error: {
          code: 'INVALID_INVITATION',
          message: 'This invitation is invalid, expired, or addressed to a different email.',
        },
      });
      return;
    }

    const body =
      input.workspaceMode === 'create'
        ? {
            name: input.name,
            email: input.email,
            password: input.password,
            organizationName: input.organizationName,
          }
        : { name: input.name, email: input.email, password: input.password };
    const { headers, response } = await auth.api.signUpEmail({
      body,
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    if (input.workspaceMode === 'join') {
      await workspaceInvitationsRepository.accept(input.inviteCode, input.email, response.user.id);
    }
    forwardCookies(res, headers);
    const user = UserSummarySchema.parse(response.user);
    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof WorkspaceNameTakenError) {
      res.status(409).json({
        error: { code: 'WORKSPACE_NAME_TAKEN', message: error.message },
      });
      return;
    }
    if (error instanceof WorkspaceInvitationError) {
      res.status(409).json({
        error: {
          code: 'INVITATION_UNAVAILABLE',
          message:
            'Your account was created, but this invitation could not be accepted. Ask the workspace admin to add your account or issue a new invitation.',
        },
      });
      return;
    }
    if (!sendAuthError(error, res)) next(error);
  }
};

export const previewInvitationController: RequestHandler = async (req, res) => {
  const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
  const email = typeof req.query.email === 'string' ? req.query.email : '';
  if (!code || !email) {
    res
      .status(400)
      .json({ error: { code: 'INVALID_INVITATION', message: 'Enter the invited email.' } });
    return;
  }
  const preview = await workspaceInvitationsRepository.preview(code, email);
  if (!preview) {
    res.status(404).json({
      error: {
        code: 'INVALID_INVITATION',
        message: 'This invitation is invalid, expired, or addressed to a different email.',
      },
    });
    return;
  }
  res.json(
    WorkspaceInvitationPreviewSchema.parse({
      email: preview.invitation.email,
      organizationName: preview.organizationName,
      role: preview.invitation.role,
      expiresAt: preview.invitation.expiresAt.toISOString(),
    }),
  );
};

export const loginController: RequestHandler = async (req, res, next) => {
  try {
    const { headers, response } = await auth.api.signInEmail({
      body: req.body,
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    forwardCookies(res, headers);
    const user = UserSummarySchema.parse(response.user);
    res.status(200).json({ user });
  } catch (error) {
    if (!sendAuthError(error, res)) next(error);
  }
};

export const logoutController: RequestHandler = async (req, res, next) => {
  try {
    const { headers } = await auth.api.signOut({
      headers: fromNodeHeaders(req.headers),
      returnHeaders: true,
    });
    forwardCookies(res, headers);
    res.status(200).json({ success: true });
  } catch (error) {
    if (!sendAuthError(error, res)) next(error);
  }
};

export const currentUserController: RequestHandler = async (req, res, next) => {
  try {
    const user = req.authSession?.user;
    if (!user) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } });
      return;
    }
    const response = AuthMeResponseSchema.parse({
      user,
      organizations: await listMembershipsForUser(user.id),
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
};
