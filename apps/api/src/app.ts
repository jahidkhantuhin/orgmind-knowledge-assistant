import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Request } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { errorHandler } from './middleware/errors.js';
import { rejectMongoOperatorKeys } from './middleware/reject-nosql-operators.js';
import {
  authRateLimiter,
  ensureRateLimitStore,
  registrationRateLimiter,
} from './middleware/rate-limit.js';

export const app = express();
app.disable('x-powered-by');
app.use((req, _res, next) => {
  req.id = randomUUID();
  next();
});
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as Request).id,
    autoLogging: {
      ignore: (req) => {
        if (env.NODE_ENV === 'production' || req.method !== 'GET') return false;
        const path = req.url?.split('?')[0] ?? '';
        return path === '/health' || /^\/organizations\/[^/]+\/documents(?:\/[^/]+)?$/.test(path);
      },
    },
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use('/api/auth/sign-in/email', ensureRateLimitStore, authRateLimiter);
app.use('/api/auth/sign-up/email', ensureRateLimitStore, registrationRateLimiter);
app.all('/api/auth/*splat', toNodeHandler(auth));
app.use(express.json({ limit: '1mb' }));
app.use(rejectMongoOperatorKeys);
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/organizations', organizationsRouter);
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});
app.use(errorHandler);
