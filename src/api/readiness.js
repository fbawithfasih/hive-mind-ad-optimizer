/**
 * Liveness and readiness.
 *
 * These answer different questions and must not be conflated:
 *
 *   liveness  — "is this process running?"  If no, restart it.
 *   readiness — "can this process serve?"   If no, do not send it traffic.
 *
 * /health was doing neither: it returned {status:'ok'} unconditionally while
 * railway.toml pointed its healthcheck at it, so a deploy whose database was
 * unreachable was declared healthy and took over from a working one.
 *
 * Liveness deliberately does NOT check Postgres or Redis. Tying restarts to a
 * dependency turns a brief database blip into a restart loop across every
 * instance, which is strictly worse than serving errors while it recovers.
 */
import { prisma } from '../db/prisma.js';
import { reportingQueue } from '../services/queue.js';

/** A dependency check must never be the reason the endpoint hangs. */
const PROBE_TIMEOUT_MS = 3_000;

async function withDeadline(promise, ms, name) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} probe exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probe(name, fn) {
  const started = Date.now();
  try {
    await withDeadline(fn(), PROBE_TIMEOUT_MS, name);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err?.message ?? String(err) };
  }
}

/**
 * Run every dependency probe. Always resolves — a failed probe is a reported
 * result, not a thrown error.
 */
export async function checkReadiness() {
  const [db, redis] = await Promise.all([
    probe('postgres', () => prisma.$queryRaw`SELECT 1`),
    probe('redis',    async () => {
      // BullMQ hands back the live IORedis connection the queues already hold,
      // so readiness reflects the connection real work uses rather than a fresh
      // one that might succeed where the pooled connection is wedged.
      const client = await reportingQueue.client;
      return client.ping();
    }),
  ]);

  return { ok: db.ok && redis.ok, checks: { postgres: db, redis } };
}

/** Liveness: the event loop is turning. Cheap, dependency-free, never 503s. */
export function livenessHandler(_req, res) {
  res.json({
    status:  'ok',
    version: process.env.BUILD_VERSION ?? null,
    commit:  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    uptime:  Math.round(process.uptime()),
  });
}

/** Readiness: 200 when every dependency answers, 503 with detail when not. */
export async function readinessHandler(_req, res) {
  const result = await checkReadiness();
  res.status(result.ok ? 200 : 503).json({
    status:  result.ok ? 'ready' : 'not_ready',
    version: process.env.BUILD_VERSION ?? null,
    commit:  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    ...result,
  });
}
