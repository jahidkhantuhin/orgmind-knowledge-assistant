import { Router } from 'express';
import { LoginSchema, RegisterSchema } from '@orgmind/shared';
import { requireAuth } from '../../auth/auth.middleware.js';
import { validate } from '../../middleware/validate.js';
import { registrationRateLimiter } from '../../middleware/rate-limit.js';
import {
  currentUserController,
  loginController,
  logoutController,
  previewInvitationController,
  registerController,
} from './auth.controller.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  registrationRateLimiter,
  validate({ body: RegisterSchema }),
  registerController,
);
authRouter.get('/invitations/:code', previewInvitationController);
authRouter.post('/login', validate({ body: LoginSchema }), loginController);
authRouter.post('/logout', logoutController);
authRouter.get('/me', requireAuth, currentUserController);
