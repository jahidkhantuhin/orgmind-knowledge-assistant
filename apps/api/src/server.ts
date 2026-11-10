import { app } from './app.js';
import { env } from './config/env.js';
import { closeConnections } from './lib/connections.js';
import { logger } from './lib/logger.js';
import { shutdownTelemetry, startTelemetry } from './lib/telemetry.js';
import { runMigrations } from './db/migrations/runner.js';
import {
  closeDocumentIngestionQueue,
  startDocumentIngestionWorker,
} from './modules/documents/document-ingestion.queue.js';

let closing = false;
startTelemetry();
const documentWorker = startDocumentIngestionWorker();
const server = app.listen(env.API_PORT, () =>
  logger.info({ port: env.API_PORT }, 'OrgMind API listening'),
);
void bootstrapDatabase();

async function bootstrapDatabase(attempt = 1): Promise<void> {
  if (closing) return;
  try {
    await runMigrations();
    logger.info('Database indexes are ready');
  } catch (error) {
    if (attempt >= 5) {
      logger.warn(
        { err: error },
        'Database bootstrap unavailable; run pnpm db:migrate when MongoDB is ready',
      );
      return;
    }
    logger.warn({ err: error, attempt }, 'Database bootstrap failed; retrying');
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    await bootstrapDatabase(attempt + 1);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'HTTP server close failed');
    await Promise.allSettled([documentWorker.close(), closeDocumentIngestionQueue()]);
    await shutdownTelemetry();
    await closeConnections();
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
