import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import { env } from '../config/env.js';

export const mongoClient = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 1500 });
export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: { connectTimeout: 1500, reconnectStrategy: false },
});
redisClient.on('error', () => undefined);

let redisConnection: Promise<void> | undefined;

export async function ensureRedisConnected(): Promise<void> {
  if (redisClient.isReady) return;
  if (!redisClient.isOpen) {
    redisConnection ??= redisClient
      .connect()
      .then(() => undefined)
      .finally(() => {
        redisConnection = undefined;
      });
    await redisConnection;
  }
  if (!redisClient.isReady) throw new Error('Redis is not ready.');
}

export function getDatabase() {
  const name = env.NODE_ENV === 'test' ? env.TEST_MONGODB_DATABASE : env.MONGODB_DATABASE;
  return mongoClient.db(name);
}

export async function checkMongo(): Promise<boolean> {
  try {
    await getDatabase().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function checkRedis(): Promise<boolean> {
  try {
    await ensureRedisConnected();
    await redisClient.ping();
    return true;
  } catch {
    if (redisClient.isOpen) await redisClient.quit().catch(() => undefined);
    return false;
  }
}

export async function closeConnections(): Promise<void> {
  await Promise.allSettled([
    mongoClient.close(),
    redisClient.isOpen ? redisClient.quit() : Promise.resolve(),
  ]);
}
