import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { RedisReply } from 'rate-limit-redis';
import { ensureRedisConnected, redisClient } from '../lib/connections.js';

const windowMs = 15 * 60 * 1000;
let authLimiter: RequestHandler | undefined;
let registrationLimiter: RequestHandler | undefined;
let chatLimiter: RequestHandler | undefined;
let limiterSetup: Promise<void> | undefined;

function redisStore(prefix: string): RedisStore {
  return new RedisStore({
    prefix,
    sendCommand: (...command: string[]) => redisClient.sendCommand(command) as Promise<RedisReply>,
  });
}

function initializeRateLimiters(): void {
  authLimiter = rateLimit({
    windowMs,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('orgmind:ratelimit:login:'),
    handler: limitHandler('Too many sign-in or registration attempts. Try again in 15 minutes.'),
  });
  registrationLimiter = rateLimit({
    windowMs,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: redisStore('orgmind:ratelimit:register:'),
    handler: limitHandler('Too many account creation attempts. Try again in 15 minutes.'),
  });
  chatLimiter = rateLimit({
    windowMs,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.authSession?.user.id ?? 'anonymous',
    store: redisStore('orgmind:ratelimit:chat:'),
    handler: limitHandler('You have sent too many questions. Try again in 15 minutes.'),
  });
}

function limitHandler(message: string): RequestHandler {
  return (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
  };
}

export const ensureRateLimitStore: RequestHandler = async (_req, res, next) => {
  try {
    await ensureRedisConnected();
    limiterSetup ??= Promise.resolve().then(initializeRateLimiters);
    await limiterSetup;
    next();
  } catch {
    limiterSetup = undefined;
    res.status(503).json({
      error: {
        code: 'RATE_LIMIT_STORE_UNAVAILABLE',
        message: 'Request protection is temporarily unavailable. Try again shortly.',
      },
    });
  }
};

function invokeLimiter(getLimiter: () => RequestHandler | undefined): RequestHandler {
  return (req, res, next) => {
    const limiter = getLimiter();
    if (!limiter) {
      res.status(503).json({
        error: {
          code: 'RATE_LIMIT_STORE_UNAVAILABLE',
          message: 'Request protection is temporarily unavailable. Try again shortly.',
        },
      });
      return;
    }
    limiter(req, res, next);
  };
}

export const authRateLimiter = invokeLimiter(() => authLimiter);
export const registrationRateLimiter = invokeLimiter(() => registrationLimiter);
export const chatRateLimiter = invokeLimiter(() => chatLimiter);
