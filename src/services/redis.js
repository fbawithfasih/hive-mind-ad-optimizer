/**
 * The one Redis connection for application state that is not a BullMQ queue.
 *
 * BullMQ requires a dedicated connection per Queue and Worker and keeps its
 * own; everything else — CSRF nonces, rate-limit counters — shares this.
 *
 * Created on first use rather than at import, so a module that merely imports
 * this does not open a socket. That matters in tests and in any process that
 * loads a route file without serving traffic.
 */
import IORedis from 'ioredis';
import { createLogger } from '../api/utils/logger.js';

const logger = createLogger('REDIS');

let client = null;

/** True when a Redis URL is configured. */
export function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

/** The shared client, connecting lazily on first command. */
export function getRedis() {
  if (!client) {
    client = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    // Without a listener, ioredis emits an unhandled 'error' event and takes
    // the process down when Redis blips.
    client.on('error', (err) => logger.error(`connection error: ${err.message}`));
  }
  return client;
}

/** Close the shared connection (server shutdown, tests). */
export async function closeRedis() {
  if (!client) return;
  const c = client;
  client = null;
  await c.quit().catch(() => {});
}
